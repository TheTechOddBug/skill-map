/**
 * `IssuePathsService`, indexes `scan().issues` by severity tier so
 * any view layer can answer "which nodes carry at least one X-severity
 * issue?" in O(1). Lives at the service layer so the graph view,
 * list view, and severity palette share one computation rather than
 * each rebuilding the same sets per render.
 *
 * The `info` tier is intentionally dropped, the rest of the UI
 * filters it out before reaching the card (only `error` + `warn`
 * surface in the node UI), and a hypothetical `info` filter would
 * mislead the operator into expecting a row.
 */

import { Injectable, computed, inject } from '@angular/core';

import { CollectionLoaderService } from './collection-loader';

export interface IIssuePathsBySeverity {
  readonly errors: ReadonlySet<string>;
  readonly warns: ReadonlySet<string>;
}

@Injectable({ providedIn: 'root' })
export class IssuePathsService {
  private readonly loader = inject(CollectionLoaderService);

  readonly bySeverity = computed<IIssuePathsBySeverity>(() => {
    const scan = this.loader.scan();
    const errors = new Set<string>();
    const warns = new Set<string>();
    if (!scan) return { errors, warns };
    for (const issue of scan.issues) {
      const bucket =
        issue.severity === 'error' ? errors : issue.severity === 'warn' ? warns : null;
      if (!bucket) continue;
      for (const id of issue.nodeIds) bucket.add(id);
    }
    return { errors, warns };
  });
}
