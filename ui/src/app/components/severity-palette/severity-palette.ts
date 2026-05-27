import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { TooltipModule } from 'primeng/tooltip';

import { SEVERITY_PALETTE_TEXTS } from '../../../i18n/severity-palette.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService, type TSeverityFilter } from '../../../services/filter-store';
import { IssuePathsService } from '../../../services/issue-paths';

/**
 * Floating palette for filtering graph nodes by audit severity tier.
 * Third sibling in `.graph__filter-stack`, sits between `<sm-kind-palette>`
 * and `<sm-link-kind-palette>`. Reuses the kind-palette pill chassis
 * but paints the glyph + count in the same severity tint the
 * node-card footer uses (`pi-times-circle` red, `pi-exclamation-triangle`
 * amber), so the toggle and the per-card footer chip read as the same
 * concept.
 *
 * Counts: each badge shows the number of currently visible nodes
 * carrying at least one issue of the matching tier. Visibility comes
 * straight from `FilterStoreService.apply` (text search + kinds +
 * stability + favorites + sidecar staleness + the severity toggles
 * themselves), so the operator sees a live preview of "how many cards
 * have an error visible right now" rather than a corpus-wide total.
 *
 * Per-button visibility uses the RAW data sets (every node with that
 * severity in the loaded scan, regardless of other filters). This way
 * a button never disappears mid-interaction just because an unrelated
 * filter narrowed the visible set, the operator can always toggle the
 * tier off again. The whole palette hides only when the loaded scan
 * has no error AND no warn issue at all.
 */
@Component({
  selector: 'sm-severity-palette',
  imports: [FormsModule, ToggleButtonModule, TooltipModule],
  templateUrl: './severity-palette.html',
  styleUrl: './severity-palette.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeverityPalette {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly issuePaths = inject(IssuePathsService);

  protected readonly texts = SEVERITY_PALETTE_TEXTS;

  /**
   * Visible node-path set, runs the SAME filter chain
   * `<sm-graph-view>` / `<sm-files-view>` use, so this palette's
   * counts always match what the operator sees on the canvas.
   */
  private readonly visibleSet = computed<ReadonlySet<string>>(() => {
    const visible = this.filters.apply(this.loader.nodes(), this.issuePaths.bySeverity());
    const set = new Set<string>();
    for (const n of visible) set.add(n.path);
    return set;
  });

  /** Raw tier sets (drives button visibility). */
  protected readonly rawErrorCount = computed(() => this.issuePaths.bySeverity().errors.size);
  protected readonly rawWarnCount = computed(() => this.issuePaths.bySeverity().warns.size);

  /** Visible-tier counts (drives badge value). */
  protected readonly errorCount = computed(() =>
    countIntersection(this.issuePaths.bySeverity().errors, this.visibleSet()),
  );
  protected readonly warnCount = computed(() =>
    countIntersection(this.issuePaths.bySeverity().warns, this.visibleSet()),
  );

  /**
   * Per-button visibility, keep the toggle in the DOM while the raw
   * data has tier nodes OR while the filter is currently active. The
   * second branch matters when an unrelated filter (kinds, stability)
   * happens to hide every error / warn node; the button stays so the
   * operator can still turn the tier filter off.
   */
  protected readonly showError = computed(
    () => this.rawErrorCount() > 0 || this.filters.severityErrorActive(),
  );
  protected readonly showWarn = computed(
    () => this.rawWarnCount() > 0 || this.filters.severityWarnActive(),
  );

  /** Hides the container when neither button would render. */
  protected readonly hasAny = computed(() => this.showError() || this.showWarn());

  constructor() {
    // Auto-clear a filter whose tier just emptied in the underlying
    // data (e.g. the analyzer was removed or the project lost every
    // node carrying that severity after a scan). Uses the RAW counts,
    // a tier whose visible count drops to zero because of an unrelated
    // filter stays active so the operator can still toggle it off.
    effect(() => {
      if (this.rawErrorCount() === 0 && this.filters.severityErrorActive()) {
        this.filters.toggleSeverity('error');
      }
      if (this.rawWarnCount() === 0 && this.filters.severityWarnActive()) {
        this.filters.toggleSeverity('warn');
      }
    });
  }

  isActive(tier: TSeverityFilter): boolean {
    return this.filters.isSeverityActive(tier);
  }

  toggle(tier: TSeverityFilter): void {
    this.filters.toggleSeverity(tier);
  }
}

function countIntersection(needle: ReadonlySet<string>, haystack: ReadonlySet<string>): number {
  // Iterate the smaller set, lookups against the larger one stay O(1).
  const [small, large] = needle.size <= haystack.size ? [needle, haystack] : [haystack, needle];
  let n = 0;
  for (const id of small) if (large.has(id)) n++;
  return n;
}
