/**
 * `NodeSparkService`, the "change spark": a one-shot ~1s flash on a
 * map node whose file the live watcher detected changed on disk
 * (`spec/job-events.md` §scan.started / §scan.progress).
 *
 * Trigger: a `scan.progress` frame with `cached: false` and no
 * `partialCache` (an extractor backfill is NOT a content change),
 * received while the in-flight scan advertised `mode: 'changed'` (the
 * watcher's scoped incremental walk). UI rescans (`POST /api/scan`)
 * pin a full re-extract and report `mode: 'full'`, and the watcher's
 * boot / meta-file batches are full traversals too, so the mode latch
 * alone excludes all of them. Deliberately NO `ScanTriggerService`
 * gate: scans are mutex-serialized server-side, gating on the
 * app-shell service would swallow a genuine watcher batch racing the
 * POST's tail, and it would drag an `app/services` import into this
 * layer (context/ui.md §Services layering).
 *
 * Agent activity wins: a spark is suppressed at flush time when
 * `NodeActivityService.wasActiveWithin(path, suppressMs)` says the
 * node is lit or went dark moments ago, so an agent-driven write
 * surfaces through the activity glow, never a double flash. New nodes
 * arrive as `cached: false` and spark naturally; deletions emit no
 * per-node frame, nothing to do.
 *
 * A re-spark inside the window refreshes the entry's expiry WITHOUT
 * replaying the CSS animation (the element stays mounted): a rapid
 * double-save yields one flash, deliberate.
 *
 * Same structural pattern as `NodeActivityService` /
 * `AgentSpawnService`: rAF-coalesced ingest, TTL-swept transient set,
 * ONE re-armed sweep timer, set-equality-guarded publishes (OnPush
 * discipline). Demo mode is inert for free: the pre-filtered streams
 * complete immediately (`events$` is `EMPTY`).
 */

import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';

import type { IWsScanProgressData } from '../models/ws-event';
import { LivePreferencesService } from './live-preferences';
import { NodeActivityService } from './node-activity';
import { scheduleFrame } from './schedule-frame';
import { WsEventStreamService } from './ws-event-stream';

/**
 * How long a spark stays mounted. Keep in sync with the
 * `sm-spark-flash` animation duration in `graph-view.css`, the
 * element unmounting is what ends the treatment.
 */
export const NODE_SPARK_DURATION_MS = new InjectionToken<number>('NODE_SPARK_DURATION_MS', {
  providedIn: 'root',
  factory: () => 1_000,
});

/**
 * Suppression window after agent activity: a node lit now, or lit
 * within this window, never sparks (2s, user call 2026-08-09). Covers
 * the agent-write double-flash: the watcher batch lands within a
 * couple of seconds of the activity glow that already told the story.
 */
export const NODE_SPARK_SUPPRESS_AFTER_ACTIVITY_MS = new InjectionToken<number>(
  'NODE_SPARK_SUPPRESS_AFTER_ACTIVITY_MS',
  { providedIn: 'root', factory: () => 2_000 },
);

@Injectable({ providedIn: 'root' })
export class NodeSparkService {
  private readonly durationMs = inject(NODE_SPARK_DURATION_MS);
  private readonly suppressMs = inject(NODE_SPARK_SUPPRESS_AFTER_ACTIVITY_MS);
  private readonly destroyRef = inject(DestroyRef);
  private readonly prefs = inject(LivePreferencesService);
  private readonly nodeActivity = inject(NodeActivityService);

  /**
   * Change-spark preference (`ui.changeSpark`), re-exposed so the
   * Settings row binds display state from the feature owner.
   */
  readonly enabled = this.prefs.changeSparkEnabled;

  /**
   * `true` while the in-flight scan advertised `mode: 'changed'`.
   * Scans are serialized behind the BFF scan mutex, so one latch
   * suffices; a `scan.started` lost to a disconnect self-heals because
   * frames only flow while a scan runs and the next one re-latches.
   */
  private sparkEligibleScan = false;

  /** Live sparks: path -> expiresAt. */
  private readonly sparks = new Map<string, number>();

  /** Rule-9 coalescing buffer: paths land here, the signal mutates once per frame. */
  private pending: string[] = [];
  private flushScheduled = false;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _sparkPaths = signal<ReadonlySet<string>>(new Set());
  /** Node paths flashing right now. Graph consumers do `sparkPaths().has(node.id)`. */
  readonly sparkPaths = this._sparkPaths.asReadonly();

  constructor() {
    const events = inject(WsEventStreamService);
    const started = events.scanStarted$.subscribe((event) => {
      this.sparkEligibleScan = event.data.mode === 'changed';
    });
    const progress = events.scanProgress$.subscribe((event) => this.onProgress(event.data));
    const completed = events.scanCompleted$.subscribe(() => {
      this.sparkEligibleScan = false;
    });
    this.destroyRef.onDestroy(() => {
      started.unsubscribe();
      progress.unsubscribe();
      completed.unsubscribe();
      if (this.sweepTimer !== null) clearTimeout(this.sweepTimer);
    });
  }

  /**
   * Flip the change-spark preference AND apply it (the Settings
   * toggle's entry point). Turning it OFF clears the live sparks and
   * the buffered frames in the same call; the WS subscriptions stay
   * attached (cheap) but `onProgress` discards frames while disabled.
   */
  setEnabled(value: boolean): void {
    this.prefs.setChangeSparkEnabled(value);
    if (value) return;
    this.pending = [];
    this.sparks.clear();
    this.sparkEligibleScan = false;
    this.publish(Date.now());
  }

  /** Cheapest gate first: pref, latch, frame predicate, then enqueue. */
  private onProgress(data: IWsScanProgressData): void {
    if (!this.prefs.changeSparkEnabled()) return;
    if (!this.sparkEligibleScan) return;
    if (data.cached !== false || data.partialCache === true) return;
    const path = data.path;
    if (typeof path !== 'string' || path.length === 0) return;
    this.pending.push(path);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    scheduleFrame(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    const batch = this.pending;
    this.pending = [];
    const now = Date.now();
    for (const path of batch) {
      // Activity wins, checked at flush time so the freshest claims
      // decide: lit now, or lit within the suppression window, means
      // no spark (the glow already told the story).
      if (this.nodeActivity.wasActiveWithin(path, this.suppressMs, now)) continue;
      this.sparks.set(path, now + this.durationMs);
    }
    this.publish(now);
  }

  /**
   * Drop expired sparks, publish the resulting set (only when it
   * actually changed, so OnPush consumers see no spurious writes), and
   * arm one sweep timer for the earliest remaining expiry.
   */
  private publish(now: number): void {
    let earliest = Number.POSITIVE_INFINITY;
    const active = new Set<string>();
    for (const [path, expiresAt] of this.sparks) {
      if (expiresAt <= now) {
        this.sparks.delete(path);
        continue;
      }
      if (expiresAt < earliest) earliest = expiresAt;
      active.add(path);
    }
    if (!setsEqual(active, this._sparkPaths())) {
      this._sparkPaths.set(active);
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
