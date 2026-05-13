import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';

import { LIST_VIEW_TEXTS } from '../../../i18n/list-view.texts';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { FilterStoreService } from '../../../services/filter-store';
import { KindRegistryService } from '../../../services/kind-registry';
import { FilterBar } from '../../components/filter-bar/filter-bar';
import { STABILITY_SEVERITY, type TTagSeverity } from '../../components/severity-map';
import { effectiveStability, effectiveVersion } from '../../../models/node-derived';
import type {
  TNodeKind,
  INodeView,
  TStability,
  IFrontmatterAgent,
} from '../../../models/node';

interface IListRow {
  path: string;
  kind: TNodeKind;
  kindLabel: string;
  kindStyle: Readonly<Record<string, string>>;
  name: string;
  detail: string | null;
  version: string;
  stability: TStability | '—';
  stabilitySeverity: TTagSeverity;
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
  ],
  templateUrl: './list-view.html',
  styleUrl: './list-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListView implements OnInit {
  private readonly loader = inject(CollectionLoaderService);
  private readonly filters = inject(FilterStoreService);
  private readonly router = inject(Router);
  private readonly kindRegistry = inject(KindRegistryService);

  protected readonly texts = LIST_VIEW_TEXTS;

  readonly loading = this.loader.loading;
  readonly error = this.loader.error;
  readonly total = this.loader.count;
  readonly filtersActive = this.filters.isActive;

  readonly rows = computed<IListRow[]>(() => {
    const filtered = this.filters.apply(this.loader.nodes());
    return filtered.map((node) => {
      const stability = rowStability(node);
      return {
        path: node.path,
        kind: node.kind,
        kindLabel: this.kindRegistry.labelOf(node.kind),
        kindStyle: kindStyleFor(node.kind),
        name: node.frontmatter.name ?? LIST_VIEW_TEXTS.missing,
        detail: nodeDetail(node),
        version: rowVersion(node),
        stability,
        stabilitySeverity: stability === '—' ? 'secondary' : STABILITY_SEVERITY[stability],
        node,
      };
    });
  });

  readonly visibleCount = computed(() => this.rows().length);

  ngOnInit(): void {
    if (this.loader.nodes().length === 0 && !this.loader.loading()) {
      void this.loader.load();
    }
  }

  openNode(row: IListRow): void {
    void this.router.navigate(['/graph'], { queryParams: { path: row.path } });
  }

  resetFilters(): void {
    this.filters.reset();
  }
}

function nodeDetail(n: INodeView): string | null {
  switch (n.kind) {
    case 'agent':
      return (n.frontmatter as IFrontmatterAgent).model ?? null;
    default:
      return null;
  }
}

/**
 * Catalog curation 2026-05-07 — sidecar-first row projections delegating
 * to `effectiveVersion` / `effectiveStability` (the canonical home for
 * the precedence rule: sidecar `annotations:` first, legacy
 * `frontmatter.metadata` as fallback). The list view wraps the helper
 * output in the `LIST_VIEW_TEXTS.missing` sentinel so the table column
 * always renders a glyph.
 */
function rowVersion(n: INodeView): string {
  return effectiveVersion(n) ?? LIST_VIEW_TEXTS.missing;
}

function rowStability(n: INodeView): TStability | '—' {
  return effectiveStability(n) ?? LIST_VIEW_TEXTS.missing;
}

/**
 * Inline tag style derived from the runtime kind registry. Background
 * and foreground come from the same `--sm-kind-<id>-bg` / `-fg` CSS
 * vars the rest of the UI uses, so the tag tints stay consistent with
 * graph nodes / palette buttons / inspector cards. Computed once per
 * row at projection time (vs. per CD pass) — the returned record is
 * stable as long as `kind` is.
 */
function kindStyleFor(kind: TNodeKind): Readonly<Record<string, string>> {
  return {
    background: `var(--sm-kind-${kind}-bg)`,
    color: `var(--sm-kind-${kind}-fg)`,
  };
}

