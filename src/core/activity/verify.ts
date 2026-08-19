/**
 * Wiring self-test engine (`sm activity status --verify`, normative
 * contract: `spec/provider-activity.md` §Wiring self-test).
 *
 * Every failure in the live-activity chain is silent by construction:
 * the bridge must exit 0 and stay quiet, the ingest answers 202 even
 * when nothing resolves, and the install-state report reads pure disk
 * state. So a crashing bridge, a dead server, or a stale `serve.json`
 * all render as a green `installed` next to a dark map. This module is
 * the one surface that can disagree, by EXECUTING the chain instead of
 * reading it: it pushes one synthetic probe event through the real
 * installed bridge and asks the server whether it arrived.
 *
 * **Security invariant (normative)**: the bridge is spawned at the path
 * this process composes (`defaultActivityBridgePath`), NEVER at the
 * command string read from the provider's hook config. That file is
 * operator territory skill-map does not own, and under clone-and-scan
 * it is authored by whoever wrote the repository, so executing a string
 * from it would turn a diagnostic verb into arbitrary code execution on
 * checkout. The wired command is only ever compared as text, which
 * `activityInstallStatus` already does through the bridge-path marker.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { IProvider } from '../../kernel/extensions/index.js';
import { defaultActivityBridgePath, defaultServeInfoPath } from '../paths/db-path.js';
import { activityInstallStatus } from './install.js';
import { buildProbePayload } from './probe.js';

/**
 * Per-provider outcome. Only `ok` proves the chain works; `not-installed`
 * and `unsupported` are skips, everything else is a failure the operator
 * must act on (see the verb's exit-code contract).
 */
export type TVerifyVerdict =
  | 'ok'
  | 'not-installed'
  | 'unsupported'
  | 'incomplete'
  | 'server-down'
  | 'bridge-failed'
  | 'not-received';

export interface IVerifyResult {
  verdict: TVerifyVerdict;
  /** Short operator-facing reason, present on every non-`ok` verdict. */
  detail?: string;
}

/** Verdicts that make the verb exit non-zero (`incomplete` and worse). */
const FAILING: ReadonlySet<TVerifyVerdict> = new Set<TVerifyVerdict>([
  'incomplete',
  'server-down',
  'bridge-failed',
  'not-received',
]);

export function isFailingVerdict(verdict: TVerifyVerdict): boolean {
  return FAILING.has(verdict);
}

/** How long the spawned bridge may run before it is killed. */
const BRIDGE_TIMEOUT_MS = 5000;
/** Total budget for the readback poll, and the gap between attempts. */
const READBACK_TIMEOUT_MS = 3000;
const READBACK_INTERVAL_MS = 100;
/** Per-request abort window; a hung server must not hang the verb. */
const READBACK_FETCH_TIMEOUT_MS = 1500;

interface IServeTarget {
  host: string;
  port: number;
}

/**
 * Readback outcome. `unreachable` is deliberately distinct from
 * `unseen`: a stale `serve.json` (the hard-kill case the bridge fails
 * open on) must read as a dead server, not as a broken bridge.
 */
export type TProbeRead = 'seen' | 'unseen' | 'unreachable';

export interface IVerifyOptions {
  /** Injected for tests; defaults to the real spawn + fetch pair. */
  runBridge?: (bridgePath: string, providerId: string, payload: string) => Promise<IBridgeRun>;
  readProbe?: (target: IServeTarget, nonce: string) => Promise<TProbeRead>;
  nonce?: string;
  /** Readback budget override; tests shrink it so a negative case is instant. */
  readbackTimeoutMs?: number;
}

export interface IBridgeRun {
  code: number | null;
  stderr: string;
  /** Set when the process could not be spawned or timed out. */
  failure?: string;
}

/**
 * Run the self-test for ONE provider. Never throws: every failure mode
 * is a verdict, because a diagnostic that crashes is worse than the
 * silence it was built to break.
 */
export async function verifyActivityWiring(
  cwd: string,
  provider: IProvider,
  options: IVerifyOptions = {},
): Promise<IVerifyResult> {
  const blocked = preflight(cwd, provider);
  if (blocked !== null) return blocked;

  const target = readServeTarget(cwd);
  if (target === null) {
    return {
      verdict: 'server-down',
      detail: 'no readable .skill-map/serve.json; is `sm serve` running?',
    };
  }
  return runProbe(cwd, provider.id, target, options);
}

/**
 * Everything decidable from disk alone: the verdict to report WITHOUT
 * executing anything, or `null` when the install looks complete enough
 * to be worth probing.
 */
function preflight(cwd: string, provider: IProvider): IVerifyResult | null {
  const install = provider.activity?.install;
  if (install === undefined) {
    return { verdict: 'unsupported', detail: 'provider declares no activity adapter' };
  }
  // Install state FIRST, so an uninstalled provider reads the same way
  // whatever its install kind: the state line already says "not
  // installed" and a second line explaining it would be noise.
  const status = activityInstallStatus(cwd, provider);
  if (!status.configWired && !status.bridgePresent) return { verdict: 'not-installed' };
  if (install.kind !== 'json-hooks') {
    // A `plugin-file` provider's plugin runs INSIDE the runtime process;
    // there is no spawnable artifact, so there is nothing to execute.
    return { verdict: 'unsupported', detail: 'in-process plugin, nothing to spawn' };
  }
  if (status.installed) return null;
  return {
    verdict: 'incomplete',
    detail: status.configWired
      ? 'hook config wired but the bridge artifact is missing'
      : 'bridge artifact present but the hook config is not wired',
  };
}

/** Execute the chain: spawn the bridge, then poll the readback. */
async function runProbe(
  cwd: string,
  providerId: string,
  target: IServeTarget,
  options: IVerifyOptions,
): Promise<IVerifyResult> {
  const nonce = options.nonce ?? randomUUID();
  const readProbe = options.readProbe ?? fetchProbe;

  // Liveness FIRST. `serve.json` survives a hard kill, and the bridge
  // fails open on an unreachable server (one stderr warning, exit 0),
  // so without this check a dead server reads as a broken bridge.
  if ((await readProbe(target, nonce)) === 'unreachable') {
    return {
      verdict: 'server-down',
      detail: `nothing answered at ${target.host}:${String(target.port)}; is \`sm serve\` running?`,
    };
  }

  const runBridge = options.runBridge ?? spawnBridge;
  const run = await runBridge(defaultActivityBridgePath(cwd), providerId, buildProbePayload(nonce));
  const failed = bridgeFailure(run);
  if (failed !== null) return { verdict: 'bridge-failed', detail: failed };

  const budget = options.readbackTimeoutMs ?? READBACK_TIMEOUT_MS;
  if (await pollProbe(target, nonce, readProbe, budget)) return { verdict: 'ok' };
  return {
    verdict: 'not-received',
    detail: 'the bridge ran clean but the server never saw the probe',
  };
}

/**
 * Why the bridge run counts as failed, or `null` when it was clean.
 * Any stderr output is a failure: the bridge's only legitimate line is
 * the stale-serve.json warning, which means the POST never landed.
 */
function bridgeFailure(run: IBridgeRun): string | null {
  if (run.failure !== undefined) return run.failure;
  if (run.code !== 0) return `bridge exited ${String(run.code)}`;
  if (run.stderr.trim().length > 0) return firstLine(run.stderr);
  return null;
}

/**
 * Spawn the installed bridge exactly as a runtime hook would: our own
 * Node executable, the bridge path we composed, the provider id as
 * argv, the payload on stdin. Killed at `BRIDGE_TIMEOUT_MS` so a hung
 * bridge cannot hang the verb.
 */
function spawnBridge(bridgePath: string, providerId: string, payload: string): Promise<IBridgeRun> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [bridgePath, providerId], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ code: null, stderr: '', failure: `could not spawn the bridge: ${String(err)}` });
      return;
    }
    let stderr = '';
    let settled = false;
    const finish = (run: IBridgeRun): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: null, stderr, failure: `bridge did not exit within ${BRIDGE_TIMEOUT_MS}ms` });
    }, BRIDGE_TIMEOUT_MS);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      finish({ code: null, stderr, failure: `could not spawn the bridge: ${err.message}` });
    });
    child.on('close', (code) => {
      finish({ code, stderr });
    });
    child.stdin.end(payload);
  });
}

/**
 * Poll the readback endpoint until the nonce shows up or the budget
 * runs out. The bridge's POST is fire-and-forget, so the ingest can
 * still be in flight when the process exits.
 */
async function pollProbe(
  target: IServeTarget,
  nonce: string,
  readProbe: (target: IServeTarget, nonce: string) => Promise<TProbeRead>,
  budgetMs: number,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if ((await readProbe(target, nonce)) === 'seen') return true;
    if (Date.now() >= deadline) return false;
    await sleep(READBACK_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read the nonce back. A transport failure is `unreachable` (no server
 * on the other end), a non-OK status or a `seen: false` body is a plain
 * `unseen`: the server IS answering, it just has not recorded it.
 */
async function fetchProbe(target: IServeTarget, nonce: string): Promise<TProbeRead> {
  let res: Response;
  try {
    const url = `http://${target.host}:${target.port}/api/activity/probe?nonce=${encodeURIComponent(nonce)}`;
    res = await fetch(url, { signal: AbortSignal.timeout(READBACK_FETCH_TIMEOUT_MS) });
  } catch {
    return 'unreachable';
  }
  if (!res.ok) return 'unseen';
  try {
    const body = (await res.json()) as { seen?: unknown };
    return body.seen === true ? 'seen' : 'unseen';
  } catch {
    return 'unseen';
  }
}

/**
 * One collapsed disclaimed shape as `GET /api/activity/disclaimed`
 * reports it (`spec/provider-activity.md` §Mapper digest). Content-free
 * by contract: two vendor discriminators plus key NAMES.
 */
export interface IDigestShape {
  outcome: string;
  hook?: string;
  tool?: string;
  keys: string[];
  count: number;
  lastAt: number;
}

/** Per-provider digest entry. */
export interface IActivityDigest {
  id: string;
  received: number;
  resolved: number;
  shapes: IDigestShape[];
}

/**
 * Read the mapper digest off the running server, keyed by provider id,
 * or `null` when there is no reachable server to ask (no `serve.json`,
 * nothing listening, an unparseable body). Null is deliberately NOT an
 * error: the digest is a supplement to the self-test, which already
 * reports `server-down` on its own, so a missing digest must degrade to
 * silence rather than to a second failure line.
 *
 * Loopback route, no token: the digest is an operator surface, exactly
 * like the probe readback.
 */
export async function readActivityDigest(cwd: string): Promise<Map<string, IActivityDigest> | null> {
  const target = readServeTarget(cwd);
  if (target === null) return null;
  const entries = await fetchDigestEntries(target);
  if (entries === null) return null;
  const out = new Map<string, IActivityDigest>();
  for (const entry of entries) {
    if (typeof entry?.id === 'string' && entry.id.length > 0) out.set(entry.id, entry);
  }
  return out;
}

/** The raw `providers` array, or `null` for every unreachable / unusable answer. */
async function fetchDigestEntries(target: IServeTarget): Promise<IActivityDigest[] | null> {
  try {
    const url = `http://${target.host}:${String(target.port)}/api/activity/disclaimed`;
    const res = await fetch(url, { signal: AbortSignal.timeout(READBACK_FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { providers?: unknown };
    return Array.isArray(body.providers) ? (body.providers as IActivityDigest[]) : null;
  } catch {
    return null;
  }
}

/**
 * Host + port of the running server, or `null` when `serve.json` is
 * missing / unparseable / malformed. Deliberately narrow: the CLI only
 * needs to reach the readback endpoint, the TOKEN stays the bridge's
 * business (which is what makes the self-test cover that path).
 */
function readServeTarget(cwd: string): IServeTarget | null {
  const info = readJsonObject(defaultServeInfoPath(cwd));
  if (info === null) return null;
  const host = info['host'];
  const port = info['port'];
  if (typeof host !== 'string' || host.length === 0) return null;
  if (!isPort(port)) return null;
  return { host, port };
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? text.trim();
}
