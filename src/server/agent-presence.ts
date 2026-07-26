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

/**
 * The liveness-probe extension (`boot-ping.ts` owns the constant's
 * story): a PING submitted and then CANCELLED without a claim in
 * between is the one event that DISPROVES attendance, the operator (or
 * the boot probe) explicitly asked "anyone there?" and nobody answered.
 */
const PING_EXTENSION = 'core/ai-ping-action';

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
   * Sequence number of the last NEGATIVE evidence: a ping cancelled
   * while still unclaimed (see `PING_EXTENSION`). Presence stops being
   * one-way here (2026-07-26, the manual Check Agent probe): a failed
   * check has the AUTHORITY to flip `attending` back to `false`, and
   * any LATER positive evidence (claim or MCP attempt) flips it true
   * again. A monotonic sequence, not timestamps, so ordering is exact
   * even for same-millisecond events.
   */
  #negativeSeq = 0;
  /** Sequence number of the last positive evidence (claim or attempt). */
  #positiveSeq = 0;
  /** Monotonic evidence clock. */
  #seq = 0;
  /** Ping job ids seen submitted this boot, awaiting claim or cancel. */
  readonly #pendingPings = new Set<string>();

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
    const frame = narrowJobFrame(envelope);
    if (frame === null) return;
    if (frame.type === CLAIM_EVENT_TYPE) this.#recordClaim(frame.jobId);
    else if (frame.type === 'job.submitted') this.#recordSubmit(frame);
    else if (frame.type === 'job.cancelled') this.#recordCancel(frame.jobId);
  }

  #recordClaim(jobId: string | null): void {
    this.#lastClaimAt = Date.now();
    this.#positiveSeq = ++this.#seq;
    if (jobId !== null) this.#pendingPings.delete(jobId);
  }

  /**
   * Track ping submits so a later cancel can be classified: only a
   * cancel of a STILL-UNCLAIMED ping is negative evidence (any other
   * cancel is queue housekeeping, silent about the agent).
   */
  #recordSubmit(frame: IJobFrame): void {
    const extensionId = (frame.data as { extensionId?: unknown } | undefined)?.extensionId;
    if (frame.jobId !== null && extensionId === PING_EXTENSION) {
      this.#pendingPings.add(frame.jobId);
    }
  }

  #recordCancel(jobId: string | null): void {
    if (jobId !== null && this.#pendingPings.delete(jobId)) {
      this.#negativeSeq = ++this.#seq;
    }
  }

  /**
   * Record a claim ATTEMPT (the MCP `claim_job` tool, empty-queue or
   * not): proof an agent is watching the queue. `lastClaimAt` stays
   * claim-only, the attempt only flips `attending`.
   */
  noteAttempt(): void {
    this.#attemptSeen = true;
    this.#positiveSeq = ++this.#seq;
  }

  /** Current state, a fresh copy (callers never hold tracker internals). */
  snapshot(): IAgentPresence {
    const everPositive = this.#attemptSeen || this.#lastClaimAt !== null;
    // Ordering decides: negative evidence (a ping nobody answered)
    // outranks OLDER positive evidence, and vice versa; the monotonic
    // sequence makes "later" exact.
    const attending = everPositive && this.#positiveSeq > this.#negativeSeq;
    return { attending, lastClaimAt: this.#lastClaimAt };
  }
}

/** Minimal narrowed view of a `job.*` envelope; `null` = not an object. */
interface IJobFrame {
  type: unknown;
  jobId: string | null;
  data: unknown;
}

function narrowJobFrame(envelope: unknown): IJobFrame | null {
  if (typeof envelope !== 'object' || envelope === null) return null;
  const frame = envelope as { type?: unknown; jobId?: unknown; data?: unknown };
  return {
    type: frame.type,
    jobId: typeof frame.jobId === 'string' ? frame.jobId : null,
    data: frame.data,
  };
}
