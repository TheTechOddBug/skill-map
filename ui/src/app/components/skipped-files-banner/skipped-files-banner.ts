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
 * The CTA appends every skipped file to `.skillmapignore` in one click
 * (`PATCH /api/project-ignore`), root-anchored so each pattern matches
 * exactly its file. The route restarts the watcher, whose fresh initial
 * batch leaves the ignored files out of the walk, so the banner clears
 * itself when that scan's `scan.completed` refreshes `scanMeta`; the
 * `done` state holds the button disabled across that window. The other
 * lever (raising `scan.maxFileSizeBytes`) lives in Settings > Project,
 * which this CTA used to merely open.
 *
 * The count is read canonically from `stats.filesOversized`, falling
 * back to `oversizedFiles.length` when the stat is absent.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { SKIPPED_FILES_BANNER_TEXTS } from '../../../i18n/skipped-files-banner.texts';
import { compactNumber } from '../../../models/node-derived';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';

/** Max number of "rest" files (after the first) enumerated in the
 *  tooltip. Above this the tooltip falls back to the console message. */
const MAX_REST_ENUMERATED = 5;

/**
 * CTA lifecycle. `done` is deliberately terminal within one skipped
 * set: the persist succeeded and the rescan is on its way, so the
 * button stays disabled instead of inviting a second (no-op) write. A
 * NEW skipped set re-arms it (see the effect in the constructor).
 */
type TCtaState = 'idle' | 'busy' | 'done';

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
  private readonly dataSource = inject(DATA_SOURCE);

  protected readonly texts = SKIPPED_FILES_BANNER_TEXTS;

  protected readonly ctaState = signal<TCtaState>('idle');
  /** Inline failure message of the last ignore write, `null` when clean. */
  protected readonly ctaError = signal<string | null>(null);

  /**
   * Identity of the CURRENT skipped set. When a scan lands with a
   * different set (files ignored, deleted, or newly oversized), the CTA
   * re-arms: without this, a banner that reappears for NEW files would
   * still carry the `done` state of the previous batch.
   */
  private readonly filesKey = computed<string>(() =>
    (this.loader.scanMeta()?.oversizedFiles ?? []).map((f) => f.path).join('\n'),
  );

  constructor() {
    effect(() => {
      this.filesKey();
      this.ctaState.set('idle');
      this.ctaError.set(null);
    });
  }

  /**
   * Derive the banner state from the current `ScanResult`. Returns
   * `visible: false` when no files were skipped for size; the template
   * short-circuits on that.
   */
  protected readonly state = computed<IBannerState>(() => {
    // `scanMeta()` is the corpus-wide source for skipped-for-size files
    // (the lazy `?meta=1` envelope carries `oversizedFiles` +
    // `stats.filesOversized`); the branch payload never carries them.
    const scan = this.loader.scanMeta();
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

  protected readonly ctaLabel = computed<string>(() => {
    switch (this.ctaState()) {
      case 'busy':
        return this.texts.ctaBusy;
      case 'done':
        return this.texts.ctaDone;
      default:
        return this.texts.cta;
    }
  });

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

  /**
   * Append every currently skipped file to `.skillmapignore`. Read the
   * live pattern list first and merge (the PATCH REPLACES the list, so
   * writing only the new entries would drop the operator's existing
   * ones); the server trims + dedupes again on its side.
   */
  protected async onCta(): Promise<void> {
    if (this.ctaState() !== 'idle') return;
    const files = this.loader.scanMeta()?.oversizedFiles ?? [];
    if (files.length === 0) return;
    this.ctaState.set('busy');
    this.ctaError.set(null);
    try {
      const current = await this.dataSource.getProjectIgnore();
      const merged = [...current.patterns];
      const seen = new Set(current.patterns);
      for (const file of files) {
        const pattern = toIgnorePattern(file.path);
        if (seen.has(pattern)) continue;
        seen.add(pattern);
        merged.push(pattern);
      }
      await this.dataSource.setProjectIgnore({ patterns: merged });
      this.ctaState.set('done');
    } catch (err) {
      this.ctaError.set(err instanceof Error ? err.message : String(err));
      this.ctaState.set('idle');
    }
  }
}

/**
 * One skipped file as a `.skillmapignore` pattern: the root-relative
 * path with a leading `/`. The anchor makes gitignore semantics exact
 * (a bare `CHANGELOG.md` would match every file of that name at any
 * depth; `/CHANGELOG.md` matches only the reported one).
 */
function toIgnorePattern(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
