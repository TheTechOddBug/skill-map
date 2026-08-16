/**
 * `ISessionReplayIntent`, the abstraction the Sessions rail uses to ask
 * "replay this session (or this agent branch) on the map" without
 * coupling to the graph view.
 *
 * Mirrors `MAP_ISOLATE_INTENT`: the rail renderer stays host-agnostic,
 * and the host that owns the map (the workspace view) overrides the
 * token with an implementation that forwards to the mounted graph view,
 * which enters the Live lens and starts a replay scoped to the
 * selection. The default is a no-op for any host that mounts the rail
 * without a map on screen.
 */

import { InjectionToken } from '@angular/core';

import type { ISessionReplaySelection, ISessionStep } from '../../services/session-index';

export interface ISessionReplayIntent {
  /**
   * Enter the lens (if needed) and replay the selected scope. When
   * `step` is given (a step row's click, user request 2026-08-16), the
   * replay seeks straight to that step's frame, identified by
   * `(tMs, path)` within the scoped tape, and keeps narrating from
   * there.
   */
  replaySession(selection: ISessionReplaySelection, label: string, step?: ISessionStep): void;
}

export const SESSION_REPLAY_INTENT = new InjectionToken<ISessionReplayIntent>(
  'SESSION_REPLAY_INTENT',
  {
    providedIn: 'root',
    factory: () => ({ replaySession: () => {} }),
  },
);
