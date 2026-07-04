/**
 * `LivePreferencesService`, user-tunable switches for the live server
 * channel, persisted in `localStorage` (per-browser, not synced), shown
 * in Settings → General:
 *
 *   - `wsEnabled`, whether the SPA opens the `/ws` WebSocket at all.
 *     OFF means no live updates of any kind: no scan refreshes, no
 *     event log frames, no node activity. The map still works through
 *     plain HTTP reads (manual refresh).
 *   - `activityEnabled`, whether real-time node activity (the executing
 *     glow driven by `node.activity` frames, `spec/provider-activity.md`)
 *     lights up the map. OFF keeps the socket (and every other live
 *     feature) untouched; only the activity lighting goes inert.
 *
 * This service is the STORAGE seam only: it owns the keys, the
 * defaults, and the signals. The behaviour lives with each feature
 * owner, `WsEventStreamService.setEnabled()` (closes / reopens the
 * socket) and `NodeActivityService.setEnabled()` (clears the lit set),
 * both of which persist through the setters here. UI code flips the
 * switches through those owners, never through this service directly,
 * so the preference and the runtime state can never diverge.
 *
 * Follows the `GraphPreferencesService` pattern: one localStorage key
 * per preference (an unrelated migration cannot corrupt the rest),
 * reads defend against malformed values, writes swallow quota errors.
 */

import { Injectable, signal } from '@angular/core';

const WS_ENABLED_KEY = 'sm.live.ws-enabled';
const ACTIVITY_ENABLED_KEY = 'sm.live.activity-enabled';

@Injectable({ providedIn: 'root' })
export class LivePreferencesService {
  private readonly _wsEnabled = signal(readStoredBool(WS_ENABLED_KEY, true));
  private readonly _activityEnabled = signal(readStoredBool(ACTIVITY_ENABLED_KEY, true));

  /** Live `/ws` channel wanted at all. Default ON. */
  readonly wsEnabled = this._wsEnabled.asReadonly();
  /** Real-time node activity lighting wanted. Default ON. */
  readonly activityEnabled = this._activityEnabled.asReadonly();

  setWsEnabled(value: boolean): void {
    if (this._wsEnabled() === value) return;
    this._wsEnabled.set(value);
    writeStoredBool(WS_ENABLED_KEY, value);
  }

  setActivityEnabled(value: boolean): void {
    if (this._activityEnabled() === value) return;
    this._activityEnabled.set(value);
    writeStoredBool(ACTIVITY_ENABLED_KEY, value);
  }
}

function readStoredBool(key: string, fallback: boolean): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function writeStoredBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Quota exceeded or storage blocked, swallow (matches the other
    // preference services).
  }
}
