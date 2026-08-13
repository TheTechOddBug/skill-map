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
 * The tape SURVIVES a reload: it is mirrored into `localStorage` under
 * `sm.live.recording` and hydrated at construction, so a refresh (or
 * coming back tomorrow) keeps the history. The operator owns its
 * lifetime, nothing here expires or rotates it by age: `clear()` (the
 * Settings row and the replay bar's delete button) is the only eraser.
 *
 * Because the operator decides when to delete, the tape would otherwise
 * grow without bound against a ~5 MB origin quota SHARED with every
 * other `sm.*` key (node positions, viewport, curation, rail state). A
 * blown quota makes those writes fail, and they all swallow the error,
 * so the failure would surface as unrelated features quietly forgetting
 * state. The mirror is therefore double-bounded, most recent wins:
 * `PERSISTED_EVENT_CAP` events AND `PERSISTED_CHAR_BUDGET` characters
 * (browsers count UTF-16 code units, so the budget is roughly half the
 * bytes it may cost). The in-memory ring stays much larger, a running
 * session keeps full fidelity and only what fits is carried across the
 * reload.
 *
 * Multi-tab: two tabs observe the SAME broadcast and mirror to the same
 * key, so they converge on the same tail; the last writer wins and no
 * merge is attempted.
 *
 * Scope and limits (Fase 1 of the playback evaluation, plan file
 * 2026-08-13): still client-only, so activity from before the page
 * opened (or while no browser was connected) never reaches the tape;
 * that gap is what the deferred server-side journal would close. The
 * ring caps at `ACTIVITY_RECORDER_CAP` events, dropping the OLDEST and
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

/** localStorage key holding the mirrored tape (see the module doc). */
export const ACTIVITY_RECORDING_KEY = 'sm.live.recording';

/**
 * Trailing slice mirrored to storage. At the playback cadence of one
 * event per second this is over an hour of replay, which is far past
 * what anyone scrubs through in one sitting.
 */
export const PERSISTED_EVENT_CAP = 4_000;

/**
 * Hard ceiling for the serialized tape, in UTF-16 characters (what
 * browsers actually meter). ~1 MB here can cost ~2 MB of a ~5 MB origin
 * budget, leaving room for every other `sm.*` key with margin to spare.
 */
export const PERSISTED_CHAR_BUDGET = 1_000_000;

/** Never trim the mirror below this: a tiny tape is still worth keeping. */
const PERSIST_MIN_EVENTS = 50;

/**
 * Write debounce. Frames arrive in bursts and `localStorage` is
 * synchronous, so mirroring per flush would stringify the whole tape on
 * the main thread mid-burst. Two seconds keeps the write off the burst
 * and still lands the tape long before a normal reload.
 */
const PERSIST_DEBOUNCE_MS = 2_000;

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

  private readonly _storedChars = signal(0);
  /**
   * Size of the mirrored tape in UTF-16 characters, `0` when nothing is
   * stored. Feeds the Settings readout so the operator can decide
   * whether the recording is worth deleting.
   */
  readonly storedChars = this._storedChars.asReadonly();

  private pending: TRecordedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Set after a write fails for good (quota exhausted even by a halved
   * tape, or storage blocked entirely). The in-memory tape keeps
   * working; only the mirror stands down, and it stays down for the
   * session so a full disk does not thrash on every burst.
   */
  private persistDisabled = false;

  constructor() {
    // BEFORE subscribing: the stored tape is history, live frames append
    // after it. Hydration is deliberately NOT gated on Real Time, the
    // recording is already made; only NEW frames honour that preference.
    this.hydrate();

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
      if (this.persistTimer !== null) {
        clearTimeout(this.persistTimer);
        // Land whatever the debounce still owed before the page goes.
        this.persistTimer = null;
        this.persist();
      }
    });
  }

  /**
   * Delete the recording, in memory AND in storage. The operator's own
   * eraser (Settings row + the replay bar's delete button); nothing
   * else drops the tape, which is the whole point of persisting it.
   * Regenerable machine data, so no confirmation dialog (same posture
   * as the Activity clear-all).
   */
  clear(): void {
    this.pending = [];
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this._events.set([]);
    this._droppedCount.set(0);
    this._storedChars.set(0);
    try {
      localStorage.removeItem(ACTIVITY_RECORDING_KEY);
    } catch {
      // Storage blocked: the in-memory tape is cleared either way.
    }
  }

  /**
   * Read the mirrored tape back. Anything unparseable or off-shape is
   * DROPPED (and the key removed) rather than repaired: a tape is
   * disposable, and carrying a half-understood shape into the fold
   * would surface as mystifying replay behaviour later.
   */
  private hydrate(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(ACTIVITY_RECORDING_KEY);
    } catch {
      return;
    }
    if (raw === null) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      const events = parsed.filter(isRecordedEvent);
      if (events.length !== parsed.length) throw new Error('off-shape entries');
      this._events.set(events);
      this._storedChars.set(raw.length);
    } catch {
      this._events.set([]);
      this._storedChars.set(0);
      try {
        localStorage.removeItem(ACTIVITY_RECORDING_KEY);
      } catch {
        // Nothing else to do; the in-memory tape simply starts empty.
      }
    }
  }

  private schedulePersist(): void {
    if (this.persistDisabled || this.persistTimer !== null) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * Mirror the tail of the tape, trimmed to BOTH bounds (see the module
   * doc). Trimming drops the oldest quarter at a time: re-serializing
   * per dropped event would be quadratic on a tape this size.
   */
  private persist(): void {
    if (this.persistDisabled) return;
    const events = this._events();
    if (events.length === 0) return;
    let slice =
      events.length > PERSISTED_EVENT_CAP
        ? events.slice(events.length - PERSISTED_EVENT_CAP)
        : events;
    let payload = JSON.stringify(slice);
    while (payload.length > PERSISTED_CHAR_BUDGET && slice.length > PERSIST_MIN_EVENTS) {
      slice = slice.slice(Math.ceil(slice.length / 4));
      payload = JSON.stringify(slice);
    }
    if (this.write(payload)) return;
    // Quota exhausted by something else in the origin: retry ONCE with
    // half the tape before standing down for the session.
    slice = slice.slice(Math.ceil(slice.length / 2));
    payload = JSON.stringify(slice);
    if (this.write(payload)) return;
    this.persistDisabled = true;
    this._storedChars.set(0);
  }

  private write(payload: string): boolean {
    try {
      localStorage.setItem(ACTIVITY_RECORDING_KEY, payload);
      this._storedChars.set(payload.length);
      return true;
    } catch {
      return false;
    }
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
    this.schedulePersist();
  }
}

/** Structural guard for a stored tape entry (see `hydrate`). */
function isRecordedEvent(value: unknown): value is TRecordedEvent {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  if (typeof row['tMs'] !== 'number') return false;
  if (row['type'] !== 'node.activity' && row['type'] !== 'agent.spawn') return false;
  return typeof row['data'] === 'object' && row['data'] !== null;
}
