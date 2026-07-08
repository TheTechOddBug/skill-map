/**
 * `<sm-branch-cap-banner>`, in-view informational banner mounted over
 * the graph map (NOT in the app shell) surfacing the map render cap.
 * Modelled on the shell `<sm-oversized-banner>` but local to the
 * workspace / graph view. Two cases, in precedence order:
 *
 *   1. BRANCH-scoped: the selected branch itself has more nodes than the
 *      cap, so `/api/branch` returned only the first slice
 *      (`branch.truncated`). Copy names the branch total + rendered.
 *   2. CORPUS-scoped: the current branch fits under the cap but the whole
 *      corpus (`corpusCount`) exceeds it. Without this the signal vanishes
 *      the moment the operator drills into a small sub-folder, even though
 *      the map still cannot show every node. Copy names the corpus total.
 *
 * No dismiss state, the banner stays until the operator narrows to a
 * branch small enough AND the corpus fits (or raises the cap).
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

/**
 * Fallback render cap used only when `scanMeta().maxRenderNodes` is
 * absent (legacy / synthetic envelopes). Mirrors `scan.maxNodes`'s design
 * default in `spec/cli-contract.md` §Map render cap.
 */
const DEFAULT_MAX_RENDER_NODES = 256;

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
   * Derive the banner state. Branch-scoped truncation wins (it is the
   * more specific, actionable message); otherwise fall back to the
   * corpus-scoped signal when the whole project overflows the cap. Both
   * absent → `visible: false` and the template short-circuits.
   */
  protected readonly state = computed<IBannerState>(() => {
    const branch = this.loader.branch()?.branch;
    if (branch?.truncated) {
      return { visible: true, body: this.texts.body(branch.total, branch.rendered) };
    }
    const corpus = this.loader.corpusCount();
    const cap = this.loader.scanMeta()?.maxRenderNodes ?? DEFAULT_MAX_RENDER_NODES;
    if (corpus > cap) {
      return { visible: true, body: this.texts.corpusBody(corpus, cap) };
    }
    return { visible: false, body: '' };
  });

  protected readonly visible = computed<boolean>(() => this.state().visible);
}
