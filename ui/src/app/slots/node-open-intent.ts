/**
 * `INodeOpenIntent`, abstraction the slot renderer catalog uses to
 * surface "the user wants to open this node" without coupling to a
 * specific Router target.
 *
 * Slot renderers are part of the shell's closed catalog (not plugin
 * code), but they can be mounted in multiple hosts: the fused
 * workspace today, tomorrow side-panels, embedded inspectors, or
 * non-graph shells. Hardcoding a fixed `router.navigate(...)` target
 * inside a renderer means a future host has to either accept the wrong
 * target or fork the renderer.
 *
 * `NgComponentOutlet` does NOT propagate component outputs to its
 * host, so an `output<>()` on the renderer is unreachable. Injecting
 * an open-intent service is the lightest workaround that keeps the
 * renderer pure and lets hosts override the navigation target via DI.
 *
 * Default implementation navigates to `/?path=<path>` (the workspace
 * route, the only view now), where the graph view's selection-url-sync
 * reads `?path`, centers the camera, and slides the inspector in.
 * Hosts that mount the renderer in non-workspace contexts override the
 * token with their own implementation (the workspace itself supplies a
 * relative-navigation override so it never tears the route).
 */

import { Injectable, InjectionToken, inject } from '@angular/core';
import { Router } from '@angular/router';

export interface INodeOpenIntent {
  open(path: string): void;
}

@Injectable({ providedIn: 'root' })
export class DefaultNodeOpenIntent implements INodeOpenIntent {
  private readonly router = inject(Router);

  open(path: string): void {
    void this.router.navigate(['/'], { queryParams: { path } });
  }
}

export const NODE_OPEN_INTENT = new InjectionToken<INodeOpenIntent>('NODE_OPEN_INTENT', {
  providedIn: 'root',
  factory: () => inject(DefaultNodeOpenIntent),
});
