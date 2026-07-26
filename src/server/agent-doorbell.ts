/**
 * Agent doorbell: wake a registered agent runtime when a job is
 * submitted, instead of requiring a session to sit parked on a blocking
 * claim (see `spec/job-lifecycle.md` §Agent doorbell).
 *
 * Boot-scoped and in-memory, the same posture as `AgentPresenceTracker`
 * (its sibling at the broadcaster choke point): the registration dies
 * with the server, re-registration is idempotent, nothing persists. The
 * runtime side registers through `POST /api/agent/doorbell` at plugin
 * load and refreshes via the `agentEndpoint` field on activity ingests,
 * so a restarted server relearns the endpoint from ordinary traffic.
 *
 * The wake itself is deliberately a DOORBELL, not a delivery: it never
 * touches the queue, never sees a nonce, never renders a prompt. It
 * creates one fresh session on the runtime's local API and fires one
 * async instruction to run the `sm-process-jobs` skill in `once` mode;
 * the claim -> execute -> record protocol takes over from there,
 * unchanged. Everything here is best-effort and fire-and-forget: a wake
 * must never block, delay, or fail the submit that triggered it.
 *
 * Safety properties, each load-bearing:
 *   - **Loopback only**: a registration whose host is not loopback is
 *     refused, so the server can never be steered into calling out.
 *   - **Consent-gated live**: `jobs.wakeOnSubmit` (project-local only,
 *     default off) is read at wake time, so the toggle needs no restart
 *     and a shared checkout cannot switch it on for a teammate.
 *   - **Still-queued check**: the wake fires only if the submitted job
 *     survives a short settle delay unclaimed, so a parked agent (which
 *     claims within its 2s poll) suppresses the doorbell naturally.
 *   - **Cooldown**: at most one wake per window; a submit burst becomes
 *     one session whose drain loop absorbs it. Losing a wake is
 *     impossible by construction (every submit re-checks; an unwoken
 *     job stays claimable by every other path).
 *   - **The boot ping never wakes** (`core/ai-ping-action`): it exists
 *     to probe an ALREADY-parked agent, waking one to answer it would
 *     spend tokens on every server restart to learn nothing.
 */

import { readConfigValue } from '../core/config/helper.js';
import { tryWithSqlite } from '../core/sqlite/with-sqlite.js';
import { bffReadVersionCheck } from './util/db-read-check.js';
import { log } from '../kernel/util/logger.js';
import { PING_EXTENSION_ID } from './boot-ping.js';
import type { IWsEventEnvelope } from './events.js';

/**
 * Untrusted-shape narrow, mirroring the presence tracker's: the
 * observer sits on the broadcast choke point where CLI-pushed envelopes
 * arrive as parsed JSON, so nothing about the shape is assumed.
 */
function isSubmitEnvelope(value: unknown): value is IWsEventEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'job.submitted'
  );
}

/** Settle delay before the still-queued re-read (ms). */
export const DOORBELL_SETTLE_MS = 2000;

/** Minimum spacing between two wakes (ms). */
export const DOORBELL_COOLDOWN_MS = 60_000;

/** Abort window for each call against the runtime's local API (ms). */
const WAKE_FETCH_TIMEOUT_MS = 5000;

/** Session title, so the operator can spot (and kill) a woken session. */
export const WAKE_SESSION_TITLE = 'skill-map jobs';

/**
 * The single async instruction a woken session receives. English like
 * every agent-facing surface; the skill carries the whole protocol, so
 * this only routes into it.
 */
export const WAKE_PROMPT =
  'skill-map queued new jobs in this project. Load the sm-process-jobs ' +
  'skill and follow it as if invoked with `once`: drain the queue (claim, ' +
  'execute, record each job), then stop. Do not stay resident.';

/** Loopback hosts a registration may name; anything else is refused. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export interface IAgentDoorbellOpts {
  cwd: string;
  dbPath: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable timings for tests. */
  settleMs?: number;
  cooldownMs?: number;
}

/** Result of a registration attempt, for the route's response mapping. */
export type TDoorbellRegisterOutcome = 'registered' | 'not-loopback' | 'invalid-url';

export class AgentDoorbell {
  readonly #cwd: string;
  readonly #dbPath: string;
  readonly #fetch: typeof fetch;
  readonly #settleMs: number;
  readonly #cooldownMs: number;

  #endpoint: URL | null = null;
  #lastWakeAt = 0;
  /** Live settle timers, cleared on close so tests never leak them. */
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(opts: IAgentDoorbellOpts) {
    this.#cwd = opts.cwd;
    this.#dbPath = opts.dbPath;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#settleMs = opts.settleMs ?? DOORBELL_SETTLE_MS;
    this.#cooldownMs = opts.cooldownMs ?? DOORBELL_COOLDOWN_MS;
  }

  /** Register (or refresh) the runtime's wake endpoint. Last write wins. */
  register(rawUrl: string): TDoorbellRegisterOutcome {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return 'invalid-url';
    }
    if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return 'not-loopback';
    const changed = this.#endpoint === null || this.#endpoint.href !== url.href;
    this.#endpoint = url;
    if (changed) log.info(`doorbell: agent endpoint registered (${url.href})`);
    return 'registered';
  }

  /** The registered endpoint, for diagnostics and tests. */
  get endpoint(): string | null {
    return this.#endpoint?.href ?? null;
  }

  /**
   * Broadcast observer, composed with the presence tracker's at the
   * composition root. Reacts only to `job.submitted`; never throws.
   */
  observe(envelope: unknown): void {
    if (!isSubmitEnvelope(envelope)) return;
    if (this.#endpoint === null) return;
    const jobId = envelope.jobId;
    if (typeof jobId !== 'string' || jobId.length === 0) return;
    const extensionId = (envelope.data as { extensionId?: unknown } | undefined)?.extensionId;
    if (extensionId === PING_EXTENSION_ID) return;
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      void this.#wakeIfStillQueued(jobId);
    }, this.#settleMs);
    this.#timers.add(timer);
  }

  /** Cancel pending settle timers (server shutdown / tests). */
  close(): void {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  async #wakeIfStillQueued(jobId: string): Promise<void> {
    try {
      if (this.#endpoint === null) return;
      const enabled =
        readConfigValue<boolean>('jobs.wakeOnSubmit', { cwd: this.#cwd, default: false }) ?? false;
      if (!enabled) return;
      if (Date.now() - this.#lastWakeAt < this.#cooldownMs) return;
      const stillQueued = await tryWithSqlite(
        { databasePath: this.#dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
        async (adapter) => (await adapter.jobs.get(jobId))?.status === 'queued',
      );
      if (stillQueued !== true) return;
      this.#lastWakeAt = Date.now();
      await this.#wake();
    } catch {
      // Fire-and-forget: a wake failure is the woken side's absence,
      // never a server problem. The job stays claimable by every path.
    }
  }

  /**
   * One session + one async prompt against the runtime's local API
   * (OpenCode's shape: `POST /session`, then
   * `POST /session/{id}/prompt_async`, which returns without holding
   * the connection for the agent's whole turn).
   */
  async #wake(): Promise<void> {
    const base = this.#endpoint!;
    const created = await this.#post(new URL('session', ensureTrailingSlash(base)), {
      title: WAKE_SESSION_TITLE,
    });
    const sessionId = (created as { id?: unknown } | null)?.id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      log.warn('doorbell: wake failed (session create returned no id)');
      return;
    }
    await this.#post(
      new URL(`session/${encodeURIComponent(sessionId)}/prompt_async`, ensureTrailingSlash(base)),
      { parts: [{ type: 'text', text: WAKE_PROMPT }] },
    );
    log.info(`doorbell: woke agent session ${sessionId}`);
  }

  /** POST JSON with the abort window; parses a JSON body when present. */
  async #post(url: URL, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WAKE_FETCH_TIMEOUT_MS);
    try {
      const res = await this.#fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        log.warn(`doorbell: runtime API answered ${res.status} for ${url.pathname}`);
        return null;
      }
      return (await res.json().catch(() => null)) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** `new URL('session', base)` drops the last path segment without this. */
function ensureTrailingSlash(url: URL): URL {
  if (url.pathname.endsWith('/')) return url;
  const out = new URL(url.href);
  out.pathname = `${out.pathname}/`;
  return out;
}
