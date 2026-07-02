/**
 * Live node activity state (`spec/provider-activity.md`).
 *
 * Consumes the pre-filtered `nodeActivity$` stream and maintains the
 * set of node paths that are executing RIGHT NOW, which the graph view
 * projects into the `.sm-gnode--executing` glow (and the lit edges of
 * the active spine).
 *
 * Span semantics live HERE, not in the BFF (the server is stateless by
 * design):
 *
 * - `phase: 'start'` marks `(nodePath, owner)` active and arms a TTL.
 *   Units with no native end signal (a Claude skill is only a ~10ms
 *   LOAD event; the following work is indistinguishable from the main
 *   context) decay when the TTL lapses. A repeated start refreshes it.
 * - `phase: 'end'` clears that owner's claim immediately (a subagent's
 *   matching `SubagentStop`). The node stays lit while OTHER owners
 *   still claim it (two instances of the same agent running at once).
 *
 * Performance (Foblex guardrails): inbound events buffer in a plain
 * array and flush ONCE per animation frame (the graph view's rule-9
 * drag-buffer pattern), so an event burst mutates the signal once, not
 * N times. The signal holds a `ReadonlySet<string>`; consumers do O(1)
 * `has()` lookups per node and only the cards whose class actually
 * flips re-render under OnPush.
 */

import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';

import type { IWsNodeActivityData } from '../models/ws-event';
import { WsEventStreamService } from './ws-event-stream';

/**
 * Decay window for units without a native end signal. Long enough to
 * cover a typical skill-guided turn segment, short enough that a stale
 * glow never outlives the operator's attention. Injectable so tests
 * (and a future settings knob) can shorten it.
 */
export const NODE_ACTIVITY_TTL_MS = new InjectionToken<number>('NODE_ACTIVITY_TTL_MS', {
  providedIn: 'root',
  factory: () => 12_000,
});

/** Owner bucket key for events that carry no `owner`. */
const ANONYMOUS_OWNER = '';

@Injectable({ providedIn: 'root' })
export class NodeActivityService {
  private readonly ttlMs = inject(NODE_ACTIVITY_TTL_MS);
  private readonly destroyRef = inject(DestroyRef);

  /** Per-path claims: owner -> expiry (unix ms). A path is active while any claim lives. */
  private readonly claims = new Map<string, Map<string, number>>();

  /** Rule-9 coalescing buffer: events land here, the signal mutates once per frame. */
  private pending: IWsNodeActivityData[] = [];
  private flushScheduled = false;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _activePaths = signal<ReadonlySet<string>>(new Set());
  /** Node paths executing right now. Graph consumers do `activePaths().has(node.id)`. */
  readonly activePaths = this._activePaths.asReadonly();

  constructor() {
    const events = inject(WsEventStreamService);
    const sub = events.nodeActivity$.subscribe((event) => this.enqueue(event.data));
    this.destroyRef.onDestroy(() => {
      sub.unsubscribe();
      if (this.sweepTimer !== null) clearTimeout(this.sweepTimer);
    });
  }

  private enqueue(data: IWsNodeActivityData): void {
    this.pending.push(data);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    scheduleFrame(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    const batch = this.pending;
    this.pending = [];
    const now = Date.now();
    for (const data of batch) {
      this.apply(data, now);
    }
    this.publish(now);
  }

  private apply(data: IWsNodeActivityData, now: number): void {
    const owner = data.owner ?? ANONYMOUS_OWNER;
    if (data.phase === 'start') {
      const owners = this.claims.get(data.nodePath) ?? new Map<string, number>();
      owners.set(owner, now + this.ttlMs);
      this.claims.set(data.nodePath, owners);
      return;
    }
    const owners = this.claims.get(data.nodePath);
    if (!owners) return;
    owners.delete(owner);
    if (owners.size === 0) this.claims.delete(data.nodePath);
  }

  /**
   * Drop expired claims, publish the resulting active set (only when it
   * actually changed, so OnPush consumers see no spurious writes), and
   * arm one sweep timer for the earliest remaining expiry.
   */
  private publish(now: number): void {
    let earliest = Number.POSITIVE_INFINITY;
    const active = new Set<string>();
    for (const [path, owners] of this.claims) {
      for (const [owner, expiresAt] of owners) {
        if (expiresAt <= now) {
          owners.delete(owner);
          continue;
        }
        if (expiresAt < earliest) earliest = expiresAt;
        active.add(path);
      }
      if (owners.size === 0) this.claims.delete(path);
    }

    if (!setsEqual(active, this._activePaths())) {
      this._activePaths.set(active);
    }

    if (this.sweepTimer !== null) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (earliest !== Number.POSITIVE_INFINITY) {
      this.sweepTimer = setTimeout(() => this.publish(Date.now()), earliest - now + 1);
    }
  }
}

/**
 * One flush per animation frame; falls back to a macrotask outside a
 * rendering context (unit tests, SSR-ish environments).
 */
function scheduleFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => fn());
    return;
  }
  setTimeout(fn, 16);
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}
