/**
 * Per-node execution stats mirror (`spec/provider-activity.md`
 * §Execution stats).
 *
 * Sibling of `NodeActivityService`, deliberately SEPARATE: the live
 * set owns claims + TTL decay and clears on Real Time off; this
 * service owns the counters, which have no decay and KEEP their last
 * snapshot while the preference is off (a counter is a fact about the
 * session, not a live glow). Only frames stop applying while off.
 *
 * The server is the single source of truth: `count` OVERWRITES from
 * every stats-bearing `node.activity` frame and from the summary
 * snapshot; the client NEVER increments. Hydration points:
 *
 *   - boot (constructor), so counters survive a page refresh;
 *   - a WS RE-stabilization (`stableConnected`, skip-first pattern:
 *     the boot connection's first stable window is already covered by
 *     the boot fetch), so a server restart's reset counters replace
 *     the stale ones;
 *   - Real Time re-enable, frames were dropped while off.
 *
 * Performance (Foblex guardrails): frames buffer and flush ONCE per
 * animation frame into a `ReadonlyMap` signal; entries keep their
 * object identity when a frame / snapshot carries equal values, so
 * OnPush consumers (the node-card pill) see no spurious re-renders.
 */

import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';

import type { INodeActivityStatsApi } from '../models/api';
import type { IWsNodeActivityData } from '../models/ws-event';
import { DATA_SOURCE } from './data-source/data-source.port';
import { LivePreferencesService } from './live-preferences';
import { WsEventStreamService } from './ws-event-stream';

@Injectable({ providedIn: 'root' })
export class NodeActivityStatsService {
  private readonly prefs = inject(LivePreferencesService);
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _stats = signal<ReadonlyMap<string, INodeActivityStatsApi>>(new Map());
  /** Per-node stats keyed by node path. Consumers do O(1) `get()` per node. */
  readonly stats = this._stats.asReadonly();

  /** Rule-9 coalescing buffer: frames land here, the signal mutates once per frame. */
  private pending: Array<{ nodePath: string; stats: INodeActivityStatsApi }> = [];
  private flushScheduled = false;

  constructor() {
    const events = inject(WsEventStreamService);
    const sub = events.nodeActivity$.subscribe((event) => this.enqueue(event.data));
    this.destroyRef.onDestroy(() => sub.unsubscribe());

    // Boot hydration. Skipped while the preference is off, the
    // re-enable effect below fetches when the user flips it on.
    if (this.prefs.activityEnabled()) void this.hydrate();

    // Re-enable refetch: react to the OFF -> ON transition only (the
    // boot state was already handled above; the ON -> OFF transition
    // keeps the map by design).
    let prevEnabled = this.prefs.activityEnabled();
    effect(() => {
      const enabled = this.prefs.activityEnabled();
      if (enabled && !prevEnabled) void this.hydrate();
      prevEnabled = enabled;
    });

    // Re-stabilize refetch, skip-first: the FIRST stable window is the
    // boot connection (boot hydrate already ran); every later one means
    // the socket dropped and recovered, i.e. the server may have
    // restarted and reset its accumulator.
    let seenFirstStable = false;
    effect(() => {
      if (!events.stableConnected()) return;
      if (!seenFirstStable) {
        seenFirstStable = true;
        return;
      }
      if (this.prefs.activityEnabled()) void this.hydrate();
    });
  }

  /**
   * Replace the map from the summary snapshot. Errors are swallowed:
   * counters are a progressive enhancement, a failed fetch leaves the
   * last known snapshot in place and the WS deltas keep flowing.
   */
  private async hydrate(): Promise<void> {
    try {
      const summary = await this.dataSource.getActivitySummary();
      this.adoptSnapshot(summary.nodes);
    } catch {
      // Swallow (see docstring).
    }
  }

  /**
   * The summary is the FULL server truth: entries it does not carry
   * were reset (server reboot), so the snapshot replaces the map
   * wholesale. Unchanged entries keep their object identity.
   */
  private adoptSnapshot(nodes: Record<string, INodeActivityStatsApi>): void {
    const current = this._stats();
    const next = new Map<string, INodeActivityStatsApi>();
    let changed = false;
    for (const [path, stats] of Object.entries(nodes)) {
      const prev = current.get(path);
      if (prev && statsEqual(prev, stats)) {
        next.set(path, prev);
      } else {
        next.set(path, stats);
        changed = true;
      }
    }
    if (next.size !== current.size) changed = true;
    if (changed) this._stats.set(next);
  }

  private enqueue(data: IWsNodeActivityData): void {
    // Real Time off: keep the last snapshot, stop updating (frames
    // drop; the map itself is NOT cleared, unlike the live glow set).
    if (!this.prefs.activityEnabled()) return;
    if (data.nodePath === undefined || data.stats === undefined) return;
    this.pending.push({ nodePath: data.nodePath, stats: data.stats });
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    scheduleFrame(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;
    const current = this._stats();
    let next: Map<string, INodeActivityStatsApi> | null = null;
    for (const { nodePath, stats } of batch) {
      const prev = (next ?? current).get(nodePath);
      // OVERWRITE semantics: the frame's stats replace the entry
      // verbatim (never `prev.count + 1`); equal values keep identity.
      if (prev && statsEqual(prev, stats)) continue;
      if (!next) next = new Map(current);
      next.set(nodePath, stats);
    }
    if (next) this._stats.set(next);
  }
}

function statsEqual(a: INodeActivityStatsApi, b: INodeActivityStatsApi): boolean {
  return (
    a.count === b.count &&
    a.lastStartAt === b.lastStartAt &&
    a.lastOwner === b.lastOwner &&
    a.distinctOwners === b.distinctOwners
  );
}

/**
 * One flush per animation frame; falls back to a macrotask outside a
 * rendering context (unit tests, SSR-ish environments). Mirrors the
 * `NodeActivityService` helper.
 */
function scheduleFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => fn());
    return;
  }
  setTimeout(fn, 16);
}
