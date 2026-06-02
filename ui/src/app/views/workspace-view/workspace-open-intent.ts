import { Injectable, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import type { INodeOpenIntent } from '../../slots/node-open-intent';

/**
 * Workspace-scoped `NODE_OPEN_INTENT`.
 *
 * The default implementation navigates to `/map?path=…`, which would
 * tear the user out of the fused workspace route. Here the map already
 * lives on the same screen as the files rail, so "open this node" only
 * has to write the shared `?path` query param: the graph view's
 * `selection-url-sync` reads it, moves the selection, centers the
 * camera, and slides the inspector in. No route change, same screen.
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
