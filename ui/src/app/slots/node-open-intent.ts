/**
 * `INodeOpenIntent` — abstraction the slot renderer catalog uses to
 * surface "the user wants to open this node" without coupling to a
 * specific Router target.
 *
 * Slot renderers are part of the shell's closed catalog (not plugin
 * code), but they can be mounted in multiple hosts: today the graph
 * view, tomorrow side-panels, embedded inspectors, or non-graph
 * shells. Hardcoding `router.navigate(['/graph'], ...)` inside a
 * renderer (the pre-2026-05-13 shape) means a future host has to
 * either accept the wrong target or fork the renderer.
 *
 * `NgComponentOutlet` does NOT propagate component outputs to its
 * host, so an `output<>()` on the renderer is unreachable. Injecting
 * an open-intent service is the lightest workaround that keeps the
 * renderer pure and lets hosts override the navigation target via DI.
 *
 * Default implementation navigates to `/graph?path=<path>` — the
 * canonical "open this node in the graph view" gesture. Hosts that
 * mount the renderer in non-graph contexts override the token with
 * their own implementation.
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
    void this.router.navigate(['/graph'], { queryParams: { path } });
  }
}

export const NODE_OPEN_INTENT = new InjectionToken<INodeOpenIntent>('NODE_OPEN_INTENT', {
  providedIn: 'root',
  factory: () => inject(DefaultNodeOpenIntent),
});
