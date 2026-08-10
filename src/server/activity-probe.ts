/**
 * Boot-scoped store of wiring-self-test nonces (see
 * `spec/provider-activity.md` §Wiring self-test).
 *
 * `sm activity status --verify` pushes ONE synthetic event through the
 * real installed bridge and then asks the server whether it arrived.
 * The bridge is fire-and-forget by contract (it discards the ingest
 * response), so the arrival has to be observable server-side: the
 * ingest route records the probe's nonce here and
 * `GET /api/activity/probe` reads it back.
 *
 * A probe is deliberately inert everywhere else: the ingest
 * short-circuits BEFORE `mapEvent`, so nothing reaches the stats
 * accumulator, the owner index, the conversation store, or the WS.
 * This store is the probe's only trace, and it dies with the process
 * (same lifetime as the execution stats, never persisted).
 */

export { PROBE_MARKER, probeNonceOf } from '../core/activity/probe.js';

/** Ring capacity; oldest nonces are evicted past it. */
export const PROBE_RING_SIZE = 64;

export class ActivityProbeStore {
  /** Insertion-ordered nonce -> arrival timestamp (epoch ms). */
  private readonly seen = new Map<string, number>();

  constructor(private readonly capacity: number = PROBE_RING_SIZE) {}

  /**
   * Record an arrived probe. Re-recording a known nonce refreshes its
   * timestamp without changing its position, so a repeated probe cannot
   * evict a different one out of turn.
   */
  record(nonce: string, at: number = Date.now()): void {
    if (!this.seen.has(nonce) && this.seen.size >= this.capacity) {
      const oldest = this.seen.keys().next();
      if (!oldest.done) this.seen.delete(oldest.value);
    }
    this.seen.set(nonce, at);
  }

  /**
   * Arrival timestamp of `nonce`, or `null` when this server has not
   * seen it. Read-only: reporting never consumes the nonce, so a
   * caller may poll the same one repeatedly.
   */
  arrivalOf(nonce: string): number | null {
    return this.seen.get(nonce) ?? null;
  }
}

