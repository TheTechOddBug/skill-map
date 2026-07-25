/**
 * Boot liveness ping: ONE `core/ai-ping-action` job submitted at server
 * start so the agent-presence question (`GET /api/agent/presence`,
 * `spec/cli-contract.md` §Serve route table) can be answered without
 * waiting for organic queue traffic.
 *
 * It is TRAFFIC, not a state machine. Nothing here tracks the ping's
 * outcome and nothing here decides whether an agent is attending: if an
 * agent claims it, the claim crosses `WsBroadcaster.broadcast()` like
 * every other claim (CLI push leg or in-process MCP tool) and the
 * passive `AgentPresenceTracker` observes it there. That is the whole
 * point, one observation path, no special case for the probe.
 *
 * Best-effort and SILENT by contract. It never delays or fails server
 * startup (the composition root fires it and forgets it), never logs,
 * and skips whenever any precondition is missing:
 *
 *   - no processing skill installed (the `no-processing-agent` gate
 *     already answers "nothing will ever claim this");
 *   - no project DB on disk (`tryWithSqlite` short-circuits);
 *   - the submit target does not resolve (e.g. `--no-built-ins`-style
 *     composition where the locked system Action is absent);
 *   - no REAL (non-virtual) node to aim at, the submit engine reads the
 *     target's body from disk so an `mcp://` node cannot be a target
 *     (same rule the Quick Start ping applies: first real node wins);
 *   - any thrown error, swallowed.
 *
 * The job is submitted through the SHARED submit engine
 * (`prepareSubmitContext` + `submitOneJob`) exactly like every other
 * submit surface, so it inherits the duplicate / drift / render rules
 * instead of re-implementing them. It is NOT broadcast and it is not
 * visible in the UI queue (`GET /api/jobs` strips host-locked system
 * extensions), so it adds no user-visible noise.
 *
 * Unclaimed cleanup: jobs never auto-expire (Decision #139), so a ping
 * still `queued` after `BOOT_PING_TIMEOUT_MS` is cancelled. A ping that
 * an agent already claimed is left alone (it is being processed, and
 * that claim is exactly the observation we wanted).
 */

import { ConfigService } from '../core/config/service.js';
import { processingSkillPresence } from '../core/agent-skill/targets.js';
import { buildActionRuntime } from '../core/jobs/action-runtime.js';
import { appendOperation } from '../core/operations-log.js';
import { prepareSubmitContext, submitOneJob } from '../core/jobs/submit-engine.js';
import type { ISubmitContext } from '../core/jobs/submit-engine.js';
import type { IPluginRuntime } from '../core/runtime/plugin-runtime.js';
import { tryWithSqlite } from '../core/sqlite/with-sqlite.js';
import type { StoragePort } from '../kernel/ports/storage.js';
import type { Node } from '../kernel/types.js';

/** Qualified id of the hidden system liveness-probe Action. */
export const PING_EXTENSION_ID = 'core/ai-ping-action';

/**
 * How long an unclaimed boot ping is allowed to sit before it is
 * cancelled. Mirrors the Quick Start panel's own probe window: long
 * enough for a parked agent's poll cycle, short enough that a queue
 * nobody drains does not keep a stale row.
 */
export const BOOT_PING_TIMEOUT_MS = 15_000;

/**
 * Window of path-ordered nodes scanned for a real (non-virtual) target.
 * Bounded on purpose: the ping is best-effort infrastructure and must not
 * hydrate a whole corpus at boot. Virtual nodes carry scheme-ish paths
 * (`mcp://...`) that sort after ordinary project paths, so the first
 * page realistically always contains a real node when one exists.
 */
const TARGET_WINDOW = 100;

export interface IBootPingDeps {
  /** Absolute project DB path (`IServerOptions.dbPath`). */
  dbPath: string;
  /** Project root (`IRuntimeContext.cwd`). */
  cwd: string;
  /** Boot-cached plugin runtime; the ping composes its submit runtime from it. */
  pluginRuntime: IPluginRuntime;
  /** Override the unclaimed-cancel window. Tests only. */
  timeoutMsOverride?: number;
}

export interface IBootPingHandle {
  /**
   * Cancel the pending cleanup timer (and suppress one that has not been
   * armed yet). Called by `createServer().close()`. Idempotent.
   */
  stop(): void;
}

/**
 * Fire the boot ping and arm its unclaimed-cleanup timer. Returns
 * immediately, the submit runs detached; every failure is swallowed
 * inside. The timer is `unref`-ed so a pending cleanup never holds the
 * process open on its own.
 */
export function startBootPing(deps: IBootPingDeps): IBootPingHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  void runBootPing(deps).then((jobId) => {
    if (jobId === null || stopped) return;
    timer = setTimeout(() => {
      void cancelWhenStillQueued(deps, jobId);
    }, deps.timeoutMsOverride ?? BOOT_PING_TIMEOUT_MS);
    timer.unref?.();
  });

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    },
  };
}

/**
 * Submit the ping, returning the job id to watch (a freshly created job,
 * or the active one an identical prior ping left behind so a wedged row
 * gets cleaned up on this boot) or `null` when anything was missing.
 * NEVER rejects: every precondition and every error resolves to `null`.
 */
export async function runBootPing(deps: IBootPingDeps): Promise<string | null> {
  try {
    // Operator gate first: with no processing skill installed nothing can
    // ever claim the ping, so submitting it is pure litter. This is the
    // same question the `no-processing-agent` submit refusal answers.
    if (!processingSkillPresence(deps.cwd).installed) return null;
    const prepared = preparePing(deps.cwd, deps.pluginRuntime);
    if (prepared === null) return null;
    const submitted = await tryWithSqlite(
      { databasePath: deps.dbPath, autoBackup: false },
      async (adapter) => {
        // A ping only gets cancelled by the timer of the server that
        // submitted it, so one whose server died first (kill, crash, a
        // quick restart) stays queued forever. The duplicate-adopt path
        // below only recovers it when this boot targets the SAME node and
        // body; sweep first so a corpus that moved on cannot accumulate a
        // wedged ping per boot.
        await sweepOrphanPings(adapter, deps.cwd);
        return submitPing(adapter, prepared);
      },
    );
    if (submitted === null || submitted === undefined) return null;
    if (submitted.created) {
      appendOperation(deps.cwd, {
        op: 'jobs.submit',
        target: submitted.nodePath,
        extension: prepared.extensionId,
        channel: 'ui',
        outcome: 'queued',
        id: submitted.id,
        detail: 'boot-ping',
      });
    }
    return submitted.id;
  } catch {
    // Best-effort by contract: a liveness probe never surfaces a failure.
    return null;
  }
}

/**
 * Cancel every QUEUED ping left behind by an earlier server. Claimed /
 * running ones are left alone: an agent is mid-probe and cancelling would
 * only confuse its record. Best-effort like the rest of this module, and
 * silent: each cancellation appends its own operations-log line, which is
 * where the trail lives.
 */
async function sweepOrphanPings(adapter: StoragePort, cwd: string): Promise<void> {
  const stale = await adapter.jobs.list({ extensionId: PING_EXTENSION_ID, status: 'queued' });
  for (const job of stale) {
    const outcome = await adapter.jobs.cancel(job.id, Date.now());
    if (outcome !== 'cancelled') continue;
    appendOperation(cwd, {
      op: 'jobs.cancel',
      target: job.nodeId,
      extension: PING_EXTENSION_ID,
      channel: 'ui',
      outcome: 'cancelled',
      id: job.id,
      detail: 'boot-ping-sweep',
    });
  }
}

/**
 * Resolve the constant-across-nodes submit context for the ping, or
 * `null` when the system Action does not resolve in this composition.
 */
function preparePing(cwd: string, pluginRuntime: IPluginRuntime): ISubmitContext | null {
  const runtime = buildActionRuntime(pluginRuntime, () => {
    // Plugin-runtime warnings are already surfaced once at boot by the
    // composition root / the submit route; the ping never speaks.
  });
  const prep = prepareSubmitContext({
    runtime,
    jobs: new ConfigService({ cwd }).effective().jobs,
    extensionId: PING_EXTENSION_ID,
    cwd,
    force: false,
    flagTtl: undefined,
    flagPriority: undefined,
  });
  return prep.ok ? prep.prepared : null;
}

/** What `submitPing` hands back: the job to watch plus whether it is new. */
interface IPingSubmission {
  id: string;
  nodePath: string;
  /** `false` when an identical prior ping already covered the node. */
  created: boolean;
}

/**
 * Run the shared submit engine against the first real node. A
 * `duplicate` outcome adopts the covering job instead of giving up: it is
 * almost always a previous boot's ping that nobody claimed, and adopting
 * it means this boot's cleanup timer clears it (if it is `running`
 * instead, an agent is demonstrably attending and the cleanup leaves it
 * alone). Any other refusal (drift, unreadable, no-findings) yields
 * `null`.
 */
async function submitPing(
  adapter: StoragePort,
  prepared: ISubmitContext,
): Promise<IPingSubmission | null> {
  const target = await firstRealNode(adapter);
  if (target === null) return null;
  const outcome = await submitOneJob(adapter, target, prepared);
  if (outcome.kind === 'created') {
    return { id: outcome.id, nodePath: target.path, created: true };
  }
  if (outcome.kind === 'duplicate') {
    return { id: outcome.existingId, nodePath: target.path, created: false };
  }
  return null;
}

/**
 * The first REAL node of the corpus (path order), the same rule the Quick
 * Start ping applies: the submit engine re-reads the target's body from
 * disk, so a virtual node (`mcp://...`, extractor-derived) can never be a
 * target. `null` when the scanned corpus has none (or is empty).
 */
async function firstRealNode(adapter: StoragePort): Promise<Node | null> {
  const nodes = await adapter.scans.findNodes({ limit: TARGET_WINDOW });
  return nodes.find((node) => node.virtual !== true) ?? null;
}

/**
 * Cancel the ping when it is STILL `queued`. A claimed / terminal job is
 * left untouched: a claim is the observation the ping existed to
 * provoke, and cancelling mid-flight would only confuse the agent's
 * record callback. Silent on every error.
 */
async function cancelWhenStillQueued(deps: IBootPingDeps, jobId: string): Promise<void> {
  try {
    await tryWithSqlite({ databasePath: deps.dbPath, autoBackup: false }, async (adapter) => {
      const job = await adapter.jobs.get(jobId);
      if (job === null || job.status !== 'queued') return;
      const outcome = await adapter.jobs.cancel(jobId, Date.now());
      if (outcome !== 'cancelled') return;
      appendOperation(deps.cwd, {
        op: 'jobs.cancel',
        target: job.nodeId,
        extension: job.extensionId,
        channel: 'ui',
        outcome: 'cancelled',
        id: jobId,
        detail: 'boot-ping',
      });
    });
  } catch {
    // Best-effort: an uncancelled ping is inert (it is hidden from the
    // UI queue) and the next boot adopts it.
  }
}
