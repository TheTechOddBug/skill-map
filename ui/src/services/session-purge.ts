/**
 * `SessionPurgeService`, one gesture, both memories (user decision
 * 2026-08-16): "delete the recording" erases the browser tape (the
 * Sessions tab / replay source, `ActivityRecorderService`) AND the
 * project's server-side session journal (`.skill-map/sessions/`, the
 * observed-relations evidence `core/observed-link-missing` folds at
 * scan time).
 *
 * Single call site since 2026-08-17: the Settings recording row, behind
 * a confirm that spells the analyzer cost out (the replay transport's
 * trash now clears the browser tape only, the journal is the evidence
 * the volume gates count on); this service only executes the decision. The journal half
 * is BEST-EFFORT: demo mode (`demo-readonly`) or an unreachable server
 * must never block erasing the local tape, and the journal stays
 * hand-deletable regardless.
 */

import { Injectable, inject, signal } from '@angular/core';

import { ActivityRecorderService } from './activity-recorder';
import { DATA_SOURCE, type IDataSourcePort } from './data-source/data-source.port';

@Injectable({ providedIn: 'root' })
export class SessionPurgeService {
  private readonly recorder = inject(ActivityRecorderService);
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);

  private readonly _purgedAt = signal(0);

  /**
   * Monotonic purge counter, bumped once the journal DELETE settles.
   * Views holding journal-derived state (the Sessions tab) react to it,
   * because the tape signals alone cannot carry the news: a purge with
   * an ALREADY-empty tape produces no tape transition, which is exactly
   * how stale journal rows survived until an F5 (field bug 2026-08-17).
   */
  readonly purgedAt = this._purgedAt.asReadonly();

  /** Erase tape + journal. Synchronous for the caller; the journal half is fire-and-forget. */
  purge(): void {
    this.recorder.clear();
    void this.dataSource
      .clearSessionJournal()
      .catch(() => {
        // Best-effort by contract (see the class doc).
      })
      .finally(() => {
        this._purgedAt.update((n) => n + 1);
      });
  }
}
