/**
 * `ActivityRecorderService`, the session tape behind the Live lens
 * playback: a bounded in-memory ring of every RAW activity frame
 * (`node.activity` + `agent.spawn`) the page received, in arrival
 * order, stamped with the server timestamp each frame already carries.
 *
 * Deliberately upstream of every rAF-coalescing consumer: the recorder
 * taps `WsEventStreamService.events$` (the single validated multicast;
 * demo mode's stream is `EMPTY`, so the recorder is inert there for
 * free) and stores frames INDIVIDUALLY, so a later playback can step
 * event by event with full fidelity. Everything else about the frames
 * stays untouched: the recorder never re-broadcasts, never mutates,
 * and holds no derived state; the pure fold in
 * `activity-playback-state.ts` computes "the map at step K" on demand.
 *
 * Scope and limits (Fase 1 of the playback evaluation, plan file
 * 2026-08-13): page-lifetime only, an F5 starts a fresh tape, and
 * activity from before the page opened does not exist here. The ring
 * caps at `ACTIVITY_RECORDER_CAP` events, dropping the OLDEST and
 * counting the drops so the playback UI can say the tape is trimmed.
 * `scan.*` / `job.*` / `watcher.*` frames are filtered out: a rescan
 * fans out one `scan.progress` per classified node and would flood the
 * tape with frames the playback cannot narrate.
 *
 * Gating mirrors the live glow: frames record only while Real Time
 * (`activityEnabled`) is on, so the tape never contains activity the
 * operator had switched off. Eagerly instantiated from an app
 * initializer (`app.config.ts`): `events$` does not replay to late
 * subscribers, a lazily-created recorder would silently start
 * mid-session.
 */

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import type { IWsAgentSpawnData, IWsNodeActivityData } from '../models/ws-event';
import {
  isAgentSpawnEvent,
  isNodeActivityEvent,
  wsEventTimestampMs,
} from '../models/ws-event';
import { LivePreferencesService } from './live-preferences';
import { WsEventStreamService } from './ws-event-stream';

/** Ring cap: ~50k frames of a few hundred bytes is ~15 MB worst case. */
export const ACTIVITY_RECORDER_CAP = 50_000;

export interface IRecordedActivityEvent {
  readonly tMs: number;
  readonly type: 'node.activity';
  readonly data: IWsNodeActivityData;
}

export interface IRecordedSpawnEvent {
  readonly tMs: number;
  readonly type: 'agent.spawn';
  readonly data: IWsAgentSpawnData;
}

export type TRecordedEvent = IRecordedActivityEvent | IRecordedSpawnEvent;

@Injectable({ providedIn: 'root' })
export class ActivityRecorderService {
  private readonly prefs = inject(LivePreferencesService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The tape. A plain array signal, replaced only on flush: frames are
   * batched into `pending` and folded in once per macrotask via a
   * 0-delay timeout (cheaper than per-frame array copies during a
   * burst, without the rAF machinery the render-side consumers need).
   */
  private readonly _events = signal<readonly TRecordedEvent[]>([]);
  readonly events = this._events.asReadonly();

  private readonly _droppedCount = signal(0);
  /** Frames the cap pushed off the head; non-zero = the tape is trimmed. */
  readonly droppedCount = this._droppedCount.asReadonly();

  readonly size = computed(() => this._events().length);

  private pending: TRecordedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const events = inject(WsEventStreamService);
    const sub = events.events$.subscribe((event) => {
      if (!this.prefs.activityEnabled()) return;
      if (isNodeActivityEvent(event)) {
        this.pending.push({ tMs: wsEventTimestampMs(event), type: 'node.activity', data: event.data });
      } else if (isAgentSpawnEvent(event)) {
        this.pending.push({ tMs: wsEventTimestampMs(event), type: 'agent.spawn', data: event.data });
      } else {
        return;
      }
      this.scheduleFlush();
    });
    this.destroyRef.onDestroy(() => {
      sub.unsubscribe();
      if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    });
  }

  /** Drop the whole tape (a fresh recording anchor). */
  clear(): void {
    this.pending = [];
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this._events.set([]);
    this._droppedCount.set(0);
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 0);
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    const current = this._events();
    let next = [...current, ...batch];
    if (next.length > ACTIVITY_RECORDER_CAP) {
      const overflow = next.length - ACTIVITY_RECORDER_CAP;
      next = next.slice(overflow);
      this._droppedCount.update((count) => count + overflow);
    }
    this._events.set(next);
  }
}
