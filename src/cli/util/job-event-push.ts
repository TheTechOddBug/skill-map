/**
 * CLI-to-server push of job-event envelopes, the live-transition leg of
 * `spec/job-events.md` §Transport. Job transitions happen in whatever
 * process runs the verb (`sm jobs submit` / `claim` / `cancel` / `fail`,
 * `sm record`), which the project's `sm serve` server cannot observe;
 * without this push a connected UI only learns of a transition on its
 * next full read.
 *
 * Discovery and authentication mirror the activity bridge
 * (`spec/provider-activity.md` §serve.json,
 * `core/activity/bridge-template.ts`), but in-process: read
 * `<scopeRoot>/.skill-map/serve.json`, then `POST /api/job-events` with
 * the per-session token in `x-skill-map-token` (`spec/cli-contract.md`
 * §HTTP API, the `POST /api/job-events` row). The server validates the
 * envelope and rebroadcasts it verbatim over `/ws`.
 *
 * The push is strictly best-effort and fire-and-forget, and it runs
 * AFTER the DB transition commits: a missing `serve.json` means no
 * server (silent no-op), a stale file fails open, and EVERY failure is
 * swallowed with zero output. Unlike the bridge (which may print one
 * stderr warning from its own detached process), this helper runs
 * inside user-facing verbs whose stdout / stderr contracts a crashed
 * server must never pollute. The verb's outcome, output, and exit code
 * are NEVER affected; the DB row stays the source of truth and a missed
 * push costs only staleness until the next read.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defaultServeInfoPath } from './db-path.js';

/**
 * Event types the CLI verbs push: the job-scoped `job.*` catalog of
 * `spec/job-events.md`. Run-level events (`run.*`) never travel this
 * leg; they exist only inside `sm record --json`'s synthetic envelope.
 */
export type TJobPushEventType =
  | 'job.submitted'
  | 'job.claimed'
  | 'job.completed'
  | 'job.failed'
  | 'job.cancelled';

/**
 * Canonical event envelope (`spec/job-events.md` §Common envelope).
 * Every pushed event is job-scoped, so `jobId` is a non-null string
 * here (`null` is reserved for the run-level events, which are not
 * pushed).
 */
export interface IJobEventEnvelope {
  type: TJobPushEventType;
  /** Unix milliseconds when the event was emitted. */
  timestamp: number;
  /** `r-<mode>-YYYYMMDD-HHMMSS-XXXX` invocation id (`generateRunId`). */
  runId: string;
  jobId: string;
  data: Record<string, unknown>;
}

/** Same loopback allow-list as the activity bridge. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Fetch abort window. Tighter than the bridge's 1500 ms: the push runs
 * inline in interactive verbs, so a hung server must never make
 * `sm jobs claim` feel slow.
 */
const PUSH_TIMEOUT_MS = 250;

/** The validated slice of `serve.json` the push needs. */
interface IServeTarget {
  host: string;
  port: number;
  token: string;
}

/**
 * Scope check (mirrors the bridge's check 2): a `serve.json` copied or
 * tampered to name ANOTHER project must never receive this project's
 * events.
 */
function scopeMatches(fileScope: unknown, scopeRoot: string): boolean {
  return typeof fileScope === 'string' && resolve(fileScope) === resolve(scopeRoot);
}

/**
 * Loopback check (bridge check 3): disk state a tampered clone can
 * rewrite must not exfiltrate events to a remote host.
 */
function isLoopbackHost(host: unknown): host is string {
  return typeof host === 'string' && LOOPBACK_HOSTS.has(host.toLowerCase());
}

/**
 * Port sanity (bridge check 3b): a non-integer / out-of-range value has
 * no legitimate reading; refuse rather than interpolate it into the URL.
 */
function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Defensively validate the parsed `serve.json` document. Returns `null`
 * (silent no-op) on ANY problem: a non-object document, a `scopeRoot`
 * naming another project, a non-loopback host, a nonsensical port, or
 * a missing token.
 */
function toServeTarget(parsed: unknown, scopeRoot: string): IServeTarget | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const info = parsed as Record<string, unknown>;
  const host = info['host'];
  const port = info['port'];
  const token = info['token'];
  if (!scopeMatches(info['scopeRoot'], scopeRoot)) return null;
  if (!isLoopbackHost(host)) return null;
  if (!isValidPort(port)) return null;
  if (typeof token !== 'string' || token.length === 0) return null;
  return { host, port, token };
}

/**
 * Read + validate `<scopeRoot>/.skill-map/serve.json`. A missing /
 * unreadable / unparseable file means no server is running (clean
 * shutdown deletes the file): silent no-op.
 */
function readServeTarget(scopeRoot: string): IServeTarget | null {
  try {
    const parsed = JSON.parse(readFileSync(defaultServeInfoPath(scopeRoot), 'utf8')) as unknown;
    return toServeTarget(parsed, scopeRoot);
  } catch {
    return null;
  }
}

/**
 * Push one job-event envelope to the project's running server, when one
 * exists. Resolves in every case; it CANNOT throw and produces no
 * output, so callers `await` it (or `void` it) right after their DB
 * transition commits without touching their exit-code mapping. The
 * response is deliberately ignored: the push is a cache-invalidation
 * hint, not a delivery contract.
 */
export async function pushJobEvent(scopeRoot: string, envelope: IJobEventEnvelope): Promise<void> {
  const target = readServeTarget(scopeRoot);
  if (target === null) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    // Bracket an IPv6 literal (`::1`) so the composed URL stays valid.
    const host = target.host.includes(':') ? `[${target.host}]` : target.host;
    await fetch(`http://${host}:${target.port}/api/job-events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-skill-map-token': target.token,
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
  } catch {
    // Unreachable / hung / refusing server: a crashed server left a
    // stale serve.json behind. Fails open, silently, by contract.
  } finally {
    clearTimeout(timer);
  }
}
