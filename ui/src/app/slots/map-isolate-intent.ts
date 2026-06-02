/**
 * `IMapIsolateIntent`, the abstraction the files rail uses to ask "isolate
 * this node's chain on the map" without coupling to the graph view.
 *
 * Mirrors `NODE_OPEN_INTENT`: the rail renderer stays host-agnostic, and
 * the host that actually owns the map (the workspace view) overrides the
 * token with an implementation that forwards to the mounted graph view.
 * The default is a no-op so the standalone `/files` route (no map on
 * screen) simply does nothing when the gesture fires.
 */

import { InjectionToken } from '@angular/core';

export interface IMapIsolateIntent {
  /** Isolate the connected chain of `path` on the map and select it. */
  isolate(path: string): void;
}

export const MAP_ISOLATE_INTENT = new InjectionToken<IMapIsolateIntent>('MAP_ISOLATE_INTENT', {
  providedIn: 'root',
  factory: () => ({ isolate: () => {} }),
});
