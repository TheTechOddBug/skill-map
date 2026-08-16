/**
 * `SessionPurgeService`, one gesture, both memories (user decision
 * 2026-08-16): "delete the recording" erases the browser tape (the
 * Sessions tab / replay source, `ActivityRecorderService`) AND the
 * project's server-side session journal (`.skill-map/sessions/`, the
 * observed-relations evidence `core/observed-link-missing` folds at
 * scan time).
 *
 * Call sites (the Settings recording row, the replay transport's
 * trash) gate the gesture behind a confirm that spells the analyzer
 * cost out; this service only executes the decision. The journal half
 * is BEST-EFFORT: demo mode (`demo-readonly`) or an unreachable server
 * must never block erasing the local tape, and the journal stays
 * hand-deletable regardless.
 */

import { Injectable, inject } from '@angular/core';

import { ActivityRecorderService } from './activity-recorder';
import { DATA_SOURCE, type IDataSourcePort } from './data-source/data-source.port';

@Injectable({ providedIn: 'root' })
export class SessionPurgeService {
  private readonly recorder = inject(ActivityRecorderService);
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);

  /** Erase tape + journal. Synchronous for the caller; the journal half is fire-and-forget. */
  purge(): void {
    this.recorder.clear();
    void this.dataSource.clearSessionJournal().catch(() => {
      // Best-effort by contract (see the class doc).
    });
  }
}
