/**
 * `ISessionRecordIntent`, the abstraction the Sessions rail uses to ask
 * "start / stop recording a session" without coupling to the graph
 * view (user decision 2026-08-16: recording is a deliberate gesture on
 * the Sessions panel, never ambient, and the toolbar lens cluster is
 * gone).
 *
 * Mirrors `SESSION_REPLAY_INTENT`: the rail renderer stays
 * host-agnostic, and the host that owns the map (the workspace view)
 * overrides the token with an implementation that forwards to the
 * mounted graph view, which starts the recorder AND enters the Live
 * lens (watching live IS what recording looks like), or stops both.
 * The default is a no-op for any host that mounts the rail without a
 * map on screen.
 */

import { InjectionToken } from '@angular/core';

export interface ISessionRecordIntent {
  /** Begin capturing the tape and watch it live on the map. */
  startRecording(): void;
  /** Stop capturing; the map returns to its curated state. */
  stopRecording(): void;
}

export const SESSION_RECORD_INTENT = new InjectionToken<ISessionRecordIntent>(
  'SESSION_RECORD_INTENT',
  {
    providedIn: 'root',
    factory: () => ({ startRecording: () => {}, stopRecording: () => {} }),
  },
);
