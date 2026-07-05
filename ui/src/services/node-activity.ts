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
import { LivePreferencesService } from './live-preferences';
import { scheduleFrame } from './schedule-frame';
import { WsEventStreamService } from './ws-event-stream';

/**
 * Decay window for MOMENTARY usage claims (a skill invocation, a
 * markdown read) with no native end signal. Long enough to cover a
 * typical turn segment, short enough that a stale glow never outlives
 * the operator's attention. Injectable so tests (and a future settings
 * knob) can shorten it.
 */
export const NODE_ACTIVITY_TTL_MS = new InjectionToken<number>('NODE_ACTIVITY_TTL_MS', {
  providedIn: 'root',
  factory: () => 12_000,
});

/**
 * Decay window for STICKY lifecycle claims (an agent's own span, a
 * parent held lit by a running child). These are meant to end via
 * owner-scoped ends; the long window is only a safety net against a
 * crashed runtime that never sends one. Kept refreshed by the owner
 * heartbeat while events flow.
 */
export const NODE_ACTIVITY_STICKY_TTL_MS = new InjectionToken<number>(
  'NODE_ACTIVITY_STICKY_TTL_MS',
  {
    providedIn: 'root',
    factory: () => 5 * 60_000,
  },
);

/** Owner bucket key for events that carry no `owner`. */
const ANONYMOUS_OWNER = '';

/** One owner's hold on a node: when it decays and which window class refreshes use. */
interface IClaim {
  expiresAt: number;
  ttlMs: number;
}

@Injectable({ providedIn: 'root' })
export class NodeActivityService {
  private readonly ttlMs = inject(NODE_ACTIVITY_TTL_MS);
  private readonly stickyTtlMs = inject(NODE_ACTIVITY_STICKY_TTL_MS);
  private readonly destroyRef = inject(DestroyRef);
  private readonly prefs = inject(LivePreferencesService);

  /**
   * Real-time activity preference (Settings → General), re-exposed so
   * the Settings toggle binds display state from the feature owner.
   */
  readonly enabled = this.prefs.activityEnabled;

  /** Per-path claims by owner. A path is active while any claim lives. */
  private readonly claims = new Map<string, Map<string, IClaim>>();

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

  /**
   * Flip the real-time activity preference AND apply it (the Settings
   * toggle's entry point). Turning it OFF darkens the map immediately:
   * buffered events drop, every claim releases, and the empty set
   * publishes in the same call. The WS subscription stays attached
   * (cheap) but `enqueue` discards frames while disabled.
   */
  setEnabled(enabled: boolean): void {
    this.prefs.setActivityEnabled(enabled);
    if (enabled) return;
    this.pending = [];
    this.claims.clear();
    this.publish(Date.now());
  }

  private enqueue(data: IWsNodeActivityData): void {
    if (!this.prefs.activityEnabled()) return;
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

    // Owner heartbeat: any signal from a context proves it is alive, so
    // every claim that owner already holds gets its window refreshed
    // (each to its own class), an actively-working chain never times
    // out mid-run even when a particular node stays quiet.
    if (data.owner !== undefined) {
      this.refreshOwnerClaims(owner, now);
    }

    // Owner-scoped end (a subagent terminated, a conversation went
    // idle): the whole execution context goes dark, so EVERY claim that
    // owner holds is released, the agent node itself plus the skills it
    // invoked and the markdowns it read, instead of each waiting out
    // its decay. Checked FIRST because the node-less owner-release form
    // carries no nodePath at all.
    if (data.phase === 'end' && data.ownerScope === true && data.owner !== undefined) {
      this.releaseOwnerEverywhere(owner);
      return;
    }
    if (data.nodePath === undefined) return;
    if (data.phase === 'start') {
      const ttl = data.sticky === true ? this.stickyTtlMs : this.ttlMs;
      const owners = this.claims.get(data.nodePath) ?? new Map<string, IClaim>();
      owners.set(owner, { expiresAt: now + ttl, ttlMs: ttl });
      this.claims.set(data.nodePath, owners);
      return;
    }
    const owners = this.claims.get(data.nodePath);
    if (!owners) return;
    owners.delete(owner);
    if (owners.size === 0) this.claims.delete(data.nodePath);
  }

  private refreshOwnerClaims(owner: string, now: number): void {
    for (const owners of this.claims.values()) {
      const claim = owners.get(owner);
      if (claim) claim.expiresAt = now + claim.ttlMs;
    }
  }

  private releaseOwnerEverywhere(owner: string): void {
    for (const [path, owners] of this.claims) {
      owners.delete(owner);
      if (owners.size === 0) this.claims.delete(path);
    }
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
      for (const [owner, claim] of owners) {
        if (claim.expiresAt <= now) {
          owners.delete(owner);
          continue;
        }
        if (claim.expiresAt < earliest) earliest = claim.expiresAt;
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

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}
