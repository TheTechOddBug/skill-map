/**
 * `<sm-oversized-banner>`, top-of-shell persistent notice rendered when
 * the scan hit its file ceiling (`scan.maxScan`) and dropped files from
 * the corpus (see `spec/cli-contract.md` §Scan ceiling,
 * `spec/schemas/scan-result.schema.json` `scanCeiling` / `scanTruncated`).
 *
 * Single mode: visible iff `scanMeta().scanTruncated` is true. The
 * walker stopped reading files past the ceiling, so the corpus the map
 * and analyzers see is incomplete until the operator trims
 * `.skillmapignore` or raises `--max-scan`. No dismiss state, the notice
 * stays until a re-scan brings the file count back under the ceiling.
 *
 * Repurposed from the prior three-mode node-cap banner: the
 * `recommendedNodeLimit` / `overrideMaxNodes` fields it read are gone,
 * replaced by the scan-wide `scanCeiling` / `scanTruncated` meta. The
 * per-branch render cap is surfaced separately by
 * `<sm-branch-cap-banner>` inside the graph view.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';

import { OVERSIZED_BANNER_TEXTS } from '../../../i18n/oversized-banner.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';

interface IBannerState {
  visible: boolean;
  body: string;
}

@Component({
  selector: 'sm-oversized-banner',
  imports: [],
  templateUrl: './oversized-banner.html',
  styleUrl: './oversized-banner.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OversizedBanner {
  private readonly loader = inject(CollectionLoaderService);

  protected readonly texts = OVERSIZED_BANNER_TEXTS;

  /**
   * Emits when the user clicks the CTA. The App shell wires it to
   * `openSettings()` so the modal opens on Project (Ignored patterns).
   * Decoupling via output keeps the banner reusable in tests without a
   * real settings service in the way.
   */
  readonly openSettings = output<void>();

  /**
   * Derive the banner state from the cached scan meta. Returns
   * `visible: false` when the scan was not truncated (or the meta /
   * ceiling are absent on a synthetic envelope); the template
   * short-circuits on that.
   */
  protected readonly state = computed<IBannerState>(() => {
    const meta = this.loader.scanMeta();
    if (!meta || meta.scanTruncated !== true) return { visible: false, body: '' };
    const ceiling = meta.scanCeiling;
    if (ceiling === undefined) return { visible: false, body: '' };
    return { visible: true, body: this.texts.body(ceiling) };
  });

  protected readonly visible = computed<boolean>(() => this.state().visible);

  protected onCta(): void {
    this.openSettings.emit();
  }
}
