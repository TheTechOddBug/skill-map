import { Injectable, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import type { INodeOpenIntent } from '../../slots/node-open-intent';

/**
 * Workspace-scoped `NODE_OPEN_INTENT`.
 *
 * The default implementation navigates to `/?path=…` via an absolute
 * `router.navigate(['/'], …)`, which re-runs the workspace route and
 * can reset transient view state. Here the map already lives on the
 * same screen as the files rail, so "open this node" only has to write
 * the shared `?path` query param relative to the current route: the
 * graph view's `selection-url-sync` reads it, moves the selection,
 * centers the camera, and slides the inspector in. No route re-entry,
 * same screen.
 */
@Injectable()
export class WorkspaceNodeOpenIntent implements INodeOpenIntent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  open(path: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { path },
      queryParamsHandling: 'merge',
    });
  }
}
