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
 * snapshot; the client NEVER increments. The per-PAIR spawn counters
 * (`pairCounts`, feeding the edge conversation-count labels) follow
 * the exact same rules, fed by the summary's `pairs` record and by
 * `agent.spawn` frames carrying `pairCount`. Hydration points:
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

import { activityPairKeyOf } from '../models/api';
import type { IActivityPairStatsApi, INodeActivityStatsApi } from '../models/api';
import type { IWsAgentSpawnData, IWsNodeActivityData } from '../models/ws-event';
import { DATA_SOURCE } from './data-source/data-source.port';
import { LivePreferencesService } from './live-preferences';
import { scheduleFrame } from './schedule-frame';
import { WsEventStreamService } from './ws-event-stream';

@Injectable({ providedIn: 'root' })
export class NodeActivityStatsService {
  private readonly prefs = inject(LivePreferencesService);
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _stats = signal<ReadonlyMap<string, INodeActivityStatsApi>>(new Map());
  /** Per-node stats keyed by node path. Consumers do O(1) `get()` per node. */
  readonly stats = this._stats.asReadonly();

  private readonly _pairCounts = signal<ReadonlyMap<string, number>>(new Map());
  /**
   * Per-pair spawn counters keyed via `activityPairKeyOf` (spec
   * §Execution stats), the source for the edge conversation-count
   * labels. Same lifecycle as `stats`: OVERWRITE from the summary
   * snapshot and from `agent.spawn` frames carrying `pairCount`; kept
   * (not cleared) while Real Time is off, frames just stop applying.
   */
  readonly pairCounts = this._pairCounts.asReadonly();

  private readonly _runNodes = signal<ReadonlySet<string>>(new Set());
  /**
   * Node paths with PERSISTENT AI-run history (the summary's
   * `runNodes`, spec §GET /api/activity/summary): the counters above
   * are boot-scoped and reset on server restart, this set is DB-backed
   * and does not, so Activity visibility survives a reboot. Snapshot
   * overwrite only (no WS delta: a run lands together with `job.*`
   * frames, and the detail fetch reads the DB directly anyway).
   */
  readonly runNodes = this._runNodes.asReadonly();

  /** Rule-9 coalescing buffer: frames land here, the signal mutates once per frame. */
  private pending: Array<{ nodePath: string; stats: INodeActivityStatsApi }> = [];
  /** Pair-counter sibling of `pending`, flushed by the same frame tick. */
  private pendingPairs: Array<{ key: string; count: number }> = [];
  private flushScheduled = false;

  constructor() {
    const events = inject(WsEventStreamService);
    const sub = events.nodeActivity$.subscribe((event) => this.enqueue(event.data));
    const spawnSub = events.agentSpawn$.subscribe((event) => this.enqueuePair(event.data));
    this.destroyRef.onDestroy(() => {
      sub.unsubscribe();
      spawnSub.unsubscribe();
    });

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
      this.adoptPairSnapshot(summary.pairs);
      this.adoptRunNodes(summary.runNodes ?? []);
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

  /**
   * The pair snapshot mirrors `adoptSnapshot`: the summary is the full
   * server truth, so it replaces the map wholesale. Counts are
   * primitives, so identity bookkeeping reduces to a value diff that
   * gates the signal write.
   */
  private adoptPairSnapshot(pairs: Record<string, IActivityPairStatsApi>): void {
    const current = this._pairCounts();
    const next = new Map<string, number>();
    let changed = false;
    for (const [key, entry] of Object.entries(pairs)) {
      next.set(key, entry.count);
      if (current.get(key) !== entry.count) changed = true;
    }
    if (next.size !== current.size) changed = true;
    if (changed) this._pairCounts.set(next);
  }

  /** Snapshot overwrite of the persistent-runs set (value-diff gated). */
  private adoptRunNodes(paths: readonly string[]): void {
    const current = this._runNodes();
    if (paths.length === current.size && paths.every((p) => current.has(p))) return;
    this._runNodes.set(new Set(paths));
  }

  private enqueue(data: IWsNodeActivityData): void {
    // Real Time off: keep the last snapshot, stop updating (frames
    // drop; the map itself is NOT cleared, unlike the live glow set).
    if (!this.prefs.activityEnabled()) return;
    if (data.nodePath === undefined || data.stats === undefined) return;
    this.pending.push({ nodePath: data.nodePath, stats: data.stats });
    this.scheduleFlush();
  }

  /**
   * `agent.spawn` frames carrying `pairCount` feed the pair map. Only
   * counted pairs ride the field (resolved child, spec §Execution
   * stats); the parent identity mirrors the server key: node path for
   * agent parents, owner (session key) for session parents. Same
   * Real-Time-off semantics as `enqueue`: drop the frame, KEEP the map.
   */
  private enqueuePair(data: IWsAgentSpawnData): void {
    if (!this.prefs.activityEnabled()) return;
    if (data.pairCount === undefined || data.childNodePath === undefined) return;
    const parent = data.parentNodePath ?? data.parentOwner;
    this.pendingPairs.push({
      key: activityPairKeyOf(parent, data.childNodePath),
      count: data.pairCount,
    });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    scheduleFrame(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    const batch = this.pending;
    this.pending = [];
    const pairBatch = this.pendingPairs;
    this.pendingPairs = [];
    if (batch.length > 0) {
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
    if (pairBatch.length > 0) {
      const current = this._pairCounts();
      let next: Map<string, number> | null = null;
      for (const { key, count } of pairBatch) {
        // OVERWRITE semantics, mirroring the node stats above.
        if ((next ?? current).get(key) === count) continue;
        if (!next) next = new Map(current);
        next.set(key, count);
      }
      if (next) this._pairCounts.set(next);
    }
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
