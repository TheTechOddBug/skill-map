/**
 * `<sm-skipped-files-banner>`, top-of-shell persistent notice rendered
 * when the loaded `ScanResult` reports files the walker refused to read
 * because they exceeded `scan.maxFileSizeBytes` (see
 * `spec/cli-contract.md` §Max file size,
 * `spec/schemas/scan-result.schema.json` `oversizedFiles` /
 * `stats.filesOversized`).
 *
 * Sibling of `<sm-oversized-banner>`: same shell position, same warn
 * palette, same persistent / derived-visibility approach (no dismiss
 * state), different data + copy.
 *
 * The banner is visible only when `count > 0`. The body always names
 * the FIRST offender as `name (humanSize)`; when more than one file was
 * skipped a trailing `...` affordance carries a tooltip:
 *
 *   - rest (`count - 1`) <= 5: list each remaining file, one per line,
 *     as `name (humanSize)`.
 *   - rest > 5 (i.e. `count > 6`): a single line pointing the operator
 *     at the scan console for the full list (no enumeration).
 *
 * The count is read canonically from `stats.filesOversized`, falling
 * back to `oversizedFiles.length` when the stat is absent.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { SKIPPED_FILES_BANNER_TEXTS } from '../../../i18n/skipped-files-banner.texts';
import { compactNumber } from '../../../models/node-derived';
import { CollectionLoaderService } from '../../../services/collection-loader';

/** Max number of "rest" files (after the first) enumerated in the
 *  tooltip. Above this the tooltip falls back to the console message. */
const MAX_REST_ENUMERATED = 5;

interface IBannerState {
  /** True when at least one file was skipped for size. */
  visible: boolean;
  /** Total count of skipped-for-size files. */
  count: number;
  /** First offender rendered as `name (humanSize)`, '' when none. */
  first: string;
  /** True when `count > 1` (the `...` affordance shows). */
  hasMore: boolean;
  /** Tooltip carried by the `...` affordance. */
  tooltip: string;
}

@Component({
  selector: 'sm-skipped-files-banner',
  imports: [TooltipModule],
  templateUrl: './skipped-files-banner.html',
  styleUrl: './skipped-files-banner.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkippedFilesBanner {
  private readonly loader = inject(CollectionLoaderService);

  protected readonly texts = SKIPPED_FILES_BANNER_TEXTS;

  /**
   * Emits when the user clicks the CTA. The App shell wires it to
   * `openSettings()` so the modal opens on Project (where
   * `scan.maxFileSizeBytes` and `.skillmapignore` live). Decoupling via
   * output keeps the banner reusable in tests without a real settings
   * service in the way.
   */
  readonly openSettings = output<void>();

  /**
   * Derive the banner state from the current `ScanResult`. Returns
   * `visible: false` when no files were skipped for size; the template
   * short-circuits on that.
   */
  protected readonly state = computed<IBannerState>(() => {
    const scan = this.loader.scan();
    const files = scan?.oversizedFiles ?? [];
    const count = scan?.stats?.filesOversized ?? files.length;

    if (count <= 0) {
      return { visible: false, count: 0, first: '', hasMore: false, tooltip: '' };
    }

    const first = files[0] ? this.describe(files[0]) : '';
    const hasMore = count > 1;

    let tooltip = '';
    if (hasMore) {
      const rest = files.slice(1);
      if (count - 1 > MAX_REST_ENUMERATED) {
        tooltip = this.texts.seeConsole;
      } else {
        tooltip = rest.map((f) => this.describe(f)).join('\n');
      }
    }

    return { visible: true, count, first, hasMore, tooltip };
  });

  protected readonly visible = computed<boolean>(() => this.state().visible);

  /**
   * Render one skipped file as `name (humanSize)`. `name` is the
   * basename of the root-relative path; `humanSize` reuses the same
   * `compactNumber` formatter the node-card / inspector use for
   * `bytesTotal`, so byte sizes read consistently across the UI.
   */
  private describe(file: { path: string; bytes: number }): string {
    const name = file.path.split('/').pop() ?? file.path;
    return `${name} (${compactNumber(file.bytes)})`;
  }

  protected onCta(): void {
    this.openSettings.emit();
  }
}
