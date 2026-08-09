/**
 * `SettingsVisibilityService`, the app-shell's "Settings just closed"
 * tick. The Settings modal is where project state that OTHER surfaces
 * render gets mutated (plugin extension toggles, the skill-actions
 * offering toggle, lens switches), and the app shell already re-probes
 * its own services on close (`App.onSettingsVisibleChange`: active
 * provider, activity readiness, processing-agent readiness). Deep
 * consumers cannot reach that handler, so this service carries the same
 * tick as a stream: the inspector's AI actions controller merges it into
 * its live-refresh sources, so the launcher catalog (`prob-extensions`)
 * re-fetches the moment the modal closes instead of waiting for the next
 * node selection or job event.
 *
 * Deliberately a plain tick with no payload: the consumers re-read their
 * own server surfaces (which recompose from live config per request), so
 * WHAT changed inside Settings never needs to travel.
 */

import { Injectable } from '@angular/core';
import { Subject, type Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SettingsVisibilityService {
  private readonly closedSubject = new Subject<void>();

  /** Emits once each time the Settings modal closes. */
  readonly closed$: Observable<void> = this.closedSubject.asObservable();

  /** Called by the app shell's visibility handler on close. */
  notifyClosed(): void {
    this.closedSubject.next();
  }
}
