import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { LIST_VIEW_TEXTS } from '../../../i18n/list-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { IssuePathsService } from '../../../services/issue-paths';
import { KindRegistryService } from '../../../services/kind-registry';
import { FilterBar } from '../../components/filter-bar/filter-bar';
import { STABILITY_SEVERITY, type TTagSeverity } from '../../components/severity-map';
import {
  compactNumber,
  effectiveIsStale,
  effectiveStaleTooltip,
  effectiveStability,
  effectiveUserTags,
} from '../../../models/node-derived';
import { NODE_CARD_TEXTS } from '../../../i18n/node-card.texts';
import { pathBasenameForLink } from '../../../services/trigger-resolve';
import type {
  TNodeKind,
  INodeView,
  TStability,
} from '../../../models/node';
import type { IIssueApi, TIssueSeverityApi } from '../../../models/api';

interface IListTagChip {
  tag: string;
  source: 'author' | 'user';
}

interface IListRow {
  path: string;
  kind: TNodeKind;
  kindLabel: string;
  kindStyle: Readonly<Record<string, string>>;
  name: string;
  /** Top chips rendered inline under the name. Capped to `TAG_CHIPS_CAP`. */
  tags: readonly IListTagChip[];
  /** `total - tags.length`; surfaces as "+N" suffix when positive. */
  tagsOverflow: number;
  /** Tooltip text listing the overflowed tags (one per line). Empty
   *  string when no overflow so the binding can be unconditional. */
  tagsOverflowTooltip: string;
  /** Incoming reference count display (raw integer or `·` when absent). */
  linksIn: string;
  linksInRaw: number;
  /** Outgoing reference count display (raw integer or `·` when absent). */
  linksOut: string;
  linksOutRaw: number;
  tokens: string;
  /** Raw token count for sorting. `0` when `tokensTotal` is undefined
   *  (missing rows fall to the bottom on descending sort). */
  tokensRaw: number;
  stability: TStability;
  stabilitySeverity: TTagSeverity;
  isStale: boolean;
  staleTooltip: string;
  errors: number;
  warns: number;
  /** Sort proxy: error count weighted heavier than warn count so an
   *  error-carrying row outranks a warn-only row regardless of total. */
  issuesRank: number;
  node: INodeView;
}


@Component({
  selector: 'sm-list-view',
  imports: [
    FilterBar,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
    MessageModule,
    ButtonModule,
    TooltipModule,
  ],
  templateUrl: './list-view.html',
  styleUrl: './list-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly issuePaths = inject(IssuePathsService);
  private readonly router = inject(Router);
  private readonly kindRegistry = inject(KindRegistryService);

  protected readonly texts = LIST_VIEW_TEXTS;

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;
  readonly total = this.loader.count;
  readonly filtersActive = this.filters.isActive;

  readonly rows = computed<IListRow[]>(() => {
    const severity = this.issuePaths.bySeverity();
    const filtered = this.filters.apply(this.loader.nodes(), severity);
    const errorCounts = countIssuesByPath(this.loader.scan()?.issues, 'error');
    const warnCounts = countIssuesByPath(this.loader.scan()?.issues, 'warn');
    return filtered.map((node) => {
      const stability = rowStability(node);
      const errors = errorCounts.get(node.path) ?? 0;
      const warns = warnCounts.get(node.path) ?? 0;
      const tokensRaw = node.tokensTotal ?? 0;
      const linksInRaw = node.linksInCount ?? 0;
      const linksOutRaw = node.linksOutCount ?? 0;
      const isStale = effectiveIsStale(node);
      const allChips = collectTagChips(node);
      const tags = allChips.slice(0, TAG_CHIPS_CAP);
      const hiddenChips = allChips.slice(TAG_CHIPS_CAP);
      const tagsOverflow = hiddenChips.length;
      const tagsOverflowTooltip = hiddenChips.map((c) => c.tag).join('\n');
      return {
        path: node.path,
        kind: node.kind,
        kindLabel: this.kindRegistry.labelOf(node.kind),
        kindStyle: kindStyleFor(node.kind),
        name: rowName(node),
        tags,
        tagsOverflow,
        tagsOverflowTooltip,
        linksIn: node.linksInCount !== undefined ? String(node.linksInCount) : LIST_VIEW_TEXTS.missing,
        linksInRaw,
        linksOut: node.linksOutCount !== undefined ? String(node.linksOutCount) : LIST_VIEW_TEXTS.missing,
        linksOutRaw,
        tokens: node.tokensTotal !== undefined ? compactNumber(node.tokensTotal) : LIST_VIEW_TEXTS.missing,
        tokensRaw,
        stability,
        stabilitySeverity: STABILITY_SEVERITY[stability],
        isStale,
        staleTooltip: isStale ? effectiveStaleTooltip(node, NODE_CARD_TEXTS.sidecar) : '',
        errors,
        warns,
        issuesRank: errors * 1000 + warns,
        node,
      };
    });
  });

  readonly visibleCount = computed(() => this.rows().length);

  /**
   * Mock preview slot, purely visual prototype to test the
   * table-plus-side-panel layout before wiring up the real inspector
   * embed. Clicking a row sets this signal; the right-hand `<aside>`
   * re-renders against the captured row. No router navigation, no
   * data fetch, just the row projection we already have.
   */
  readonly previewRow = signal<IListRow | null>(null);

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  openNode(row: IListRow): void {
    this.previewRow.set(row);
  }

  resetFilters(): void {
    this.filters.reset();
  }
}

/**
 * Display name for a node row. Mirrors the graph's `node-card.displayName`
 * resolution rule: prefer `frontmatter.name` when present and non-blank,
 * otherwise derive a friendly basename via `pathBasenameForLink`
 * (which honours the `<dir>/<name>/SKILL.md` convention by returning
 * the parent directory rather than the literal `SKILL` filename). The
 * `'·'` sentinel is reserved for the truly anonymous case where even
 * the path basename collapses to an empty string.
 */
function rowName(n: INodeView): string {
  const fromFm = n.frontmatter.name?.trim();
  if (fromFm) return fromFm;
  return pathBasenameForLink(n.path) || LIST_VIEW_TEXTS.missing;
}

/**
 * Hard cap on inline chips per row. The Name column is flex-sized so
 * the cap is conservative (3) to keep the row reading at table density,
 * the remainder collapses into a "+N" suffix. Same cap node-card uses,
 * keeps the two surfaces visually aligned.
 */
const TAG_CHIPS_CAP = 3;

/**
 * Dual-source tag list for a row, mirroring `node-card.tagChips`:
 * `frontmatter.tags` renders first as `author`-variant chips, then
 * sidecar-curated `effectiveUserTags` renders as `user`-variant chips.
 * The two attribution sources stay visually distinct in the chip CSS.
 */
function collectTagChips(n: INodeView): IListTagChip[] {
  const out: IListTagChip[] = [];
  const fm = n.frontmatter as Record<string, unknown>;
  const author = fm['tags'];
  if (Array.isArray(author)) {
    for (const t of author) {
      if (typeof t === 'string' && t.length > 0) out.push({ tag: t, source: 'author' });
    }
  }
  for (const t of effectiveUserTags(n)) out.push({ tag: t, source: 'user' });
  return out;
}

/**
 * Sidecar-first stability projection delegating to `effectiveStability`
 * (the canonical home for the precedence rule: sidecar `annotations:`
 * first, legacy `frontmatter.metadata` as fallback). The list view
 * conflates "unspecified" with `stable`: visually the table treats a
 * node without a declared stability as the implicit default so the
 * column reads coherently. The spec still distinguishes the two states
 * at the model layer (see `effectiveStability`), this collapse is a
 * surface-only choice for the list table.
 */
function rowStability(n: INodeView): TStability {
  return effectiveStability(n) ?? 'stable';
}

/**
 * Per-node issue count keyed by `node.path` for a given severity tier.
 * Each `IIssueApi` whose severity matches contributes `+1` to every
 * path listed in its `nodeIds`. Mirrors the row-level chip semantics:
 * the column shows "issues touching this node", not "distinct issue
 * messages anywhere in the scan".
 */
function countIssuesByPath(
  issues: readonly IIssueApi[] | undefined,
  severity: TIssueSeverityApi,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!issues) return out;
  for (const issue of issues) {
    if (issue.severity !== severity) continue;
    for (const path of issue.nodeIds) {
      out.set(path, (out.get(path) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Inline tag style derived from the runtime kind registry. Background
 * and foreground come from the same `--sm-kind-<id>-bg` / `-fg` CSS
 * vars the rest of the UI uses, so the tag tints stay consistent with
 * graph nodes / palette buttons / inspector cards. Computed once per
 * row at projection time (vs. per CD pass), the returned record is
 * stable as long as `kind` is.
 */
function kindStyleFor(kind: TNodeKind): Readonly<Record<string, string>> {
  return {
    background: `var(--sm-kind-${kind}-bg)`,
    color: `var(--sm-kind-${kind}-fg)`,
  };
}

