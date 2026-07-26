/**
 * In-memory "has a processing agent been observed attending this
 * project's queue?" tracker (`spec/cli-contract.md` §Serve route table,
 * the `GET /api/agent/presence` row). Process lifetime only:
 * instantiated once in `createServer`, reset on every boot, never
 * persisted, exactly like `ActivityStatsService`.
 *
 * WHY this exists (and why it is NOT the MCP session count): an agent
 * parked on `sm jobs claim --wait` talks straight to SQLite and holds no
 * MCP session at all, so a live-session probe reports a perfectly healthy
 * setup as disconnected. The honest signal is the CLAIM itself, and every
 * claim reaches this process through one choke point,
 * `WsBroadcaster.broadcast()`:
 *
 *   - a CLI claim POSTs its `job.claimed` envelope to `/api/job-events`,
 *     which rebroadcasts it verbatim;
 *   - the MCP `claim_job` tool broadcasts its own `job.claimed`
 *     in-process.
 *
 * So the composition root registers `observe` as the broadcaster's
 * envelope observer and both paths are counted identically. The
 * broadcaster itself stays a dumb transport; it knows nothing about
 * presence.
 *
 * STICKY by design: `attending` starts `false` and flips `true` on the
 * FIRST observed claim, never back. A parked agent claims only when work
 * arrives, so silence proves nothing, and any TTL would manufacture false
 * negatives (the operator's agent sits idle for ten minutes, the panel
 * declares it gone). `lastClaimAt` carries the recency for display.
 */

/** Read projection of the tracker, the wire `value` of `GET /api/agent/presence`. */
export interface IAgentPresence {
  /**
   * `true` once a `job.claimed` OR an MCP claim attempt has been
   * observed this boot. Never flips back (see the file header on
   * stickiness).
   */
  attending: boolean;
  /** Epoch-ms of the most recent observed claim; `null` before the first. */
  lastClaimAt: number | null;
}

/** The one envelope type that proves an agent is draining the queue. */
const CLAIM_EVENT_TYPE = 'job.claimed';

export class AgentPresenceTracker {
  #lastClaimAt: number | null = null;
  /**
   * Sticky like the claim flag: set by `noteAttempt()` when an agent
   * ASKS for work through the MCP `claim_job` tool, job or no job. A
   * parked `claim_job { wait }` on an empty queue claims nothing for
   * hours, yet that agent is attending by definition, it is literally
   * waiting for work; without this, the inspector's "no agent has
   * picked up work" warning outlived the moment the agent arrived.
   */
  #attemptSeen = false;

  /**
   * Observe one broadcast envelope. Records a claim when it is a
   * `job.claimed` frame and ignores everything else (`scan.*`,
   * `node.activity`, the other four `job.*` types, ...).
   *
   * The parameter is `unknown` on purpose: the CLI push leg forwards a
   * client-supplied body VERBATIM through the broadcaster, so this
   * narrows defensively instead of trusting a shape. A malformed frame
   * is simply not a claim.
   */
  observe(envelope: unknown): void {
    if (!isClaimEnvelope(envelope)) return;
    this.#lastClaimAt = Date.now();
  }

  /**
   * Record a claim ATTEMPT (the MCP `claim_job` tool, empty-queue or
   * not): proof an agent is watching the queue. `lastClaimAt` stays
   * claim-only, the attempt only flips `attending`.
   */
  noteAttempt(): void {
    this.#attemptSeen = true;
  }

  /** Current state, a fresh copy (callers never hold tracker internals). */
  snapshot(): IAgentPresence {
    return {
      attending: this.#attemptSeen || this.#lastClaimAt !== null,
      lastClaimAt: this.#lastClaimAt,
    };
  }
}

/** `true` when the envelope is an object whose `type` is `job.claimed`. */
function isClaimEnvelope(envelope: unknown): boolean {
  if (typeof envelope !== 'object' || envelope === null) return false;
  return (envelope as { type?: unknown }).type === CLAIM_EVENT_TYPE;
}
