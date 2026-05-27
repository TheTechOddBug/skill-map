/**
 * `<sm-oversized-banner>`, top-of-shell persistent notice rendered when
 * the loaded `ScanResult` is at or above `scan.maxNodes` (see
 * `spec/cli-contract.md` §Node cap, `spec/schemas/scan-result.schema.json`
 * `recommendedNodeLimit` / `overrideMaxNodes`).
 *
 * Three render modes drive the body copy:
 *
 *   - `capped`, `stats.filesWalked > effectiveLimit`. The walker
 *     actually stopped accepting files; data was dropped. Strongest
 *     phrasing, red palette.
 *   - `overLimit`, `stats.nodesCount > recommendedNodeLimit` AND
 *     `overrideMaxNodes !== null`. Graph is bigger than recommended,
 *     allowed through via `--max-nodes` override. Yellow palette.
 *   - `atLimit`, `stats.nodesCount >= recommendedNodeLimit` (no
 *     override above it). Soft warning at the recommended cap, yellow.
 *
 * Visibility is purely derived, the banner appears when any of the
 * three modes is true and hides as soon as a re-scan brings the graph
 * back under the recommended limit. There is no dismiss state, the
 * graph is genuinely too big to read until it is trimmed.
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

type TBannerMode = 'capped' | 'overLimit' | 'atLimit' | 'hidden';

interface IBannerState {
  mode: TBannerMode;
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
   * `openSettings()` so the modal opens on Project → Ignored patterns.
   * Decoupling via output keeps the banner reusable in tests without
   * a real settings service in the way.
   */
  readonly openSettings = output<void>();

  /**
   * Derive the banner state from the current `ScanResult`. Returns
   * `mode: 'hidden'` when the graph fits comfortably under the
   * recommended cap; the template short-circuits on that.
   */
  protected readonly state = computed<IBannerState>(() => {
    const scan = this.loader.scan();
    if (!scan) return { mode: 'hidden', body: '' };
    const recommended = scan.recommendedNodeLimit;
    if (recommended === undefined) return { mode: 'hidden', body: '' };
    const override = scan.overrideMaxNodes ?? null;
    const effectiveLimit = override ?? recommended;
    const filesWalked = scan.stats.filesWalked;
    const nodesCount = scan.stats.nodesCount;

    // Capped: the walker iterated past the effective cap at least once
    // before breaking. Per the walker in `src/kernel/orchestrator/walk.ts`,
    // `filesWalked` increments before the cap check, so a real cap-hit
    // leaves `filesWalked === effectiveLimit + 1` at minimum.
    if (filesWalked > effectiveLimit) {
      return {
        mode: 'capped',
        body: this.texts.bodyCapped(
          filesWalked,
          effectiveLimit,
          override !== null ? 'override' : 'setting',
        ),
      };
    }

    if (nodesCount < recommended) return { mode: 'hidden', body: '' };

    if (override !== null && nodesCount > recommended) {
      return {
        mode: 'overLimit',
        body: this.texts.bodyOverLimit(nodesCount, recommended, override),
      };
    }

    return {
      mode: 'atLimit',
      body: this.texts.bodyAtLimit(nodesCount, recommended),
    };
  });

  protected readonly visible = computed<boolean>(
    () => this.state().mode !== 'hidden',
  );

  protected onCta(): void {
    this.openSettings.emit();
  }
}
