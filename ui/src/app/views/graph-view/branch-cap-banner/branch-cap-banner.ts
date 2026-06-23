/**
 * `<sm-branch-cap-banner>`, in-view informational banner mounted over
 * the graph map (NOT in the app shell) when the selected branch has more
 * nodes than the server render cap, so `/api/branch` returned only the
 * first slice. Modelled on the shell `<sm-oversized-banner>` but local
 * to the workspace / graph view and driven by the branch payload.
 *
 * Visibility is purely derived: visible iff `branch().branch.truncated`.
 * No dismiss state, the banner stays until the operator narrows to a
 * sub-folder small enough that the whole branch renders.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';

import { BRANCH_CAP_BANNER_TEXTS } from '../../../../i18n/branch-cap-banner.texts';
import { CollectionLoaderService } from '../../../../services/collection-loader';

interface IBannerState {
  visible: boolean;
  body: string;
}

@Component({
  selector: 'sm-branch-cap-banner',
  imports: [],
  templateUrl: './branch-cap-banner.html',
  styleUrl: './branch-cap-banner.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchCapBanner {
  private readonly loader = inject(CollectionLoaderService);

  protected readonly texts = BRANCH_CAP_BANNER_TEXTS;

  /**
   * Derive the banner state from the current branch. Returns
   * `visible: false` when the branch fits under the cap; the template
   * short-circuits on that.
   */
  protected readonly state = computed<IBannerState>(() => {
    const branch = this.loader.branch()?.branch;
    if (!branch || !branch.truncated) return { visible: false, body: '' };
    return {
      visible: true,
      body: this.texts.body(branch.total, branch.rendered),
    };
  });

  protected readonly visible = computed<boolean>(() => this.state().visible);
}
