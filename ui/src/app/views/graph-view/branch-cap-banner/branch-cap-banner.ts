/**
 * `<sm-branch-cap-banner>`, in-view informational banner mounted over
 * the graph map (NOT in the app shell) surfacing the map render cap.
 * Modelled on the shell `<sm-oversized-banner>` but local to the
 * workspace / graph view.
 *
 * Shows ONLY when the current scope itself overflows the cap, i.e.
 * `/api/branch` returned a truncated slice (`branch.truncated`); the
 * copy names the scoped total + rendered. A scope that fits renders NO
 * banner even when the whole corpus exceeds the cap (user decision
 * 2026-07-28, reverting the earlier corpus-scoped fallback: once the
 * operator narrowed to a fitting branch the message read as noise, and
 * the auto-opened folders rail already signals that the map is scoped).
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
   * Derive the banner state: visible only on branch-scoped truncation
   * (the current scope overflows the cap). A fitting scope shows
   * nothing, whatever the corpus size.
   */
  protected readonly state = computed<IBannerState>(() => {
    const branch = this.loader.branch()?.branch;
    if (branch?.truncated) {
      return { visible: true, body: this.texts.body(branch.total, branch.rendered) };
    }
    return { visible: false, body: '' };
  });

  protected readonly visible = computed<boolean>(() => this.state().visible);
}
