/**
 * Cross-view filter state. Kept in a root-level service so the list view,
 * graph view, and (future) inspector-list all read the same filter values
 * without URL coupling. Resetting is a single call.
 *
 * Step 14.5.d — kinds are open per Provider. The "all kinds active"
 * universe is no longer a hardcoded enum; the toggle reads it from the
 * `KindRegistryService` (Provider-declared visual catalog) at call time
 * so a user-plugin Provider that adds a new kind participates in the
 * toggle / filter-bar without code changes here.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import {
  isStaleSidecar,
  legacyFrontmatterMetadata,
  type TNodeKind,
  type INodeView,
  type TStability,
} from '../models/node';
import { KindRegistryService } from './kind-registry';

export const ALL_STABILITIES: readonly TStability[] = ['stable', 'experimental', 'deprecated'];

@Injectable({ providedIn: 'root' })
export class FilterStoreService {
  private readonly kindRegistry = inject(KindRegistryService);

  readonly searchText = signal<string>('');
  readonly selectedKinds = signal<TNodeKind[]>([]);
  readonly selectedStabilities = signal<TStability[]>([]);
  readonly hasIssuesOnly = signal<boolean>(false);
  /**
   * Active tag filter — single tag plus optional source narrow.
   * `null` = no tag filter. Click a tag chip in the annotations
   * panel to set; click the same chip again to clear.
   *
   * Shape:
   *   - `tag`: the literal tag string (case-preserving).
   *   - `source`: `'author'` matches `frontmatter.tags`,
   *     `'user'` matches `sidecar.annotations.tags`, `'any'` matches
   *     either side (the union — same default as `sm list --tag`).
   *
   * Single-tag filter only (no AND / OR composition); revisit when
   * faceted multi-tag UX is needed. The graph view applies it by
   * checking `node.tags?.byAuthor` / `node.tags?.byUser` against the
   * filter; empty / missing `node.tags` means the node fails the
   * filter (treated as "no tags" rather than "tags unknown" — the
   * BFF always projects from `scan_node_tags`, so absence is real).
   */
  readonly tagFilter = signal<{ tag: string; source: 'author' | 'user' | 'any' } | null>(null);
  /**
   * Step 9.6.5 — when true, only nodes whose sidecar overlay is in the
   * "stale" set (`stale-body` / `stale-frontmatter` / `stale-both`)
   * pass the filter. Nodes with no sidecar OR with a `fresh` overlay
   * are filtered out.
   */
  readonly staleOnly = signal<boolean>(false);
  /**
   * When true, only nodes whose `isFavorite` is true pass the filter.
   * Visibility of the corresponding toggle button in the filter-bar is
   * gated by `CollectionLoaderService.hasAnyFavorites` (the toggle
   * hides while the user has zero favorites — see the filter-bar
   * template for the exact visibility rule).
   */
  readonly favoritesOnly = signal<boolean>(false);

  readonly isActive = computed(
    () =>
      this.searchText().trim().length > 0 ||
      this.selectedKinds().length > 0 ||
      this.selectedStabilities().length > 0 ||
      this.hasIssuesOnly() ||
      this.staleOnly() ||
      this.favoritesOnly() ||
      this.tagFilter() !== null,
  );

  setSearchText(value: string): void {
    this.searchText.set(value);
  }

  setKinds(kinds: TNodeKind[]): void {
    this.selectedKinds.set([...kinds]);
  }

  /**
   * Toggle a single kind. Semantics align with `apply()`:
   *   - empty `selectedKinds` array = "no kind filter" = all kinds active.
   *   - non-empty array = whitelist; only listed kinds pass.
   * The toggle treats the current visible set (all kinds when empty) as
   * the starting point, flips the requested kind, and normalises back to
   * the empty array when every kind is on (so the filter-bar `isActive`
   * computation keeps reading false for the all-on state).
   */
  toggleKind(kind: TNodeKind): void {
    const sel = this.selectedKinds();
    const universe = this.kindRegistry.kinds().map((k) => k.name);
    const startSet = sel.length === 0 ? new Set<TNodeKind>(universe) : new Set(sel);
    if (startSet.has(kind)) {
      startSet.delete(kind);
    } else {
      startSet.add(kind);
    }
    if (startSet.size === universe.length) {
      this.selectedKinds.set([]);
    } else {
      this.selectedKinds.set([...startSet]);
    }
  }

  /** True when the kind is currently visible (passes the kind filter). */
  isKindActive(kind: TNodeKind): boolean {
    const sel = this.selectedKinds();
    if (sel.length === 0) return true;
    return sel.includes(kind);
  }

  setStabilities(stabilities: TStability[]): void {
    this.selectedStabilities.set([...stabilities]);
  }

  setHasIssuesOnly(value: boolean): void {
    this.hasIssuesOnly.set(value);
  }

  setStaleOnly(value: boolean): void {
    this.staleOnly.set(value);
  }

  setFavoritesOnly(value: boolean): void {
    this.favoritesOnly.set(value);
  }

  /**
   * Click-on-tag entry point. The annotations panel emits
   * `(tag, source)` when a chip is clicked; this method:
   *
   *   - Sets the filter to `{ tag, source }` when nothing is active
   *     OR when the active filter targets a different tag / source.
   *   - **Clears** the filter when the user clicks the chip whose
   *     tag + source matches the current filter — same chip = toggle
   *     off, intuitive for single-tag UX.
   *
   * The `source` here is always the literal source of the chip the
   * user clicked (`'author'` or `'user'`) — never `'any'`. The
   * `'any'` mode is reserved for programmatic / URL-driven filters
   * (e.g. a future `?tag=foo` query param).
   */
  toggleTagFilter(tag: string, source: 'author' | 'user'): void {
    const current = this.tagFilter();
    if (current && current.tag === tag && current.source === source) {
      this.tagFilter.set(null);
    } else {
      this.tagFilter.set({ tag, source });
    }
  }

  /** Programmatic setter — used by URL ingestion and tests. */
  setTagFilter(filter: { tag: string; source: 'author' | 'user' | 'any' } | null): void {
    this.tagFilter.set(filter);
  }

  /** Convenience clear — used by the filter bar's "x" button. */
  clearTagFilter(): void {
    this.tagFilter.set(null);
  }

  reset(): void {
    this.searchText.set('');
    this.selectedKinds.set([]);
    this.selectedStabilities.set([]);
    this.hasIssuesOnly.set(false);
    this.staleOnly.set(false);
    this.favoritesOnly.set(false);
    this.tagFilter.set(null);
  }

  /**
   * Applies every active filter to a list of nodes:
   * (1) text search over path / name / description; (2) kind membership;
   * (3) stability membership; (4) issues-only; (5) stale-only;
   * (6) favorites-only; (7) tag filter (dual-source). Empty filter
   * values are treated as "allow all".
   */
  apply(nodes: INodeView[]): INodeView[] {
    const text = this.searchText().trim().toLowerCase();
    const kinds = this.selectedKinds();
    const stabilities = this.selectedStabilities();
    const issuesOnly = this.hasIssuesOnly();
    const staleOnly = this.staleOnly();
    const favoritesOnly = this.favoritesOnly();
    const tag = this.tagFilter();

    return nodes.filter((n) => {
      if (text) {
        const haystack = [
          n.path,
          n.frontmatter.name ?? '',
          n.frontmatter.description ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(text)) return false;
      }
      if (kinds.length > 0 && !kinds.includes(n.kind)) return false;
      if (stabilities.length > 0) {
        const s = effectiveStability(n);
        if (!s || !stabilities.includes(s)) return false;
      }
      if (issuesOnly && !nodeHasIssues(n)) return false;
      if (staleOnly && !isStaleSidecar(n.sidecar)) return false;
      if (favoritesOnly && n.isFavorite !== true) return false;
      if (tag && !nodeMatchesTagFilter(n, tag)) return false;
      return true;
    });
  }
}

/**
 * Dual-source tag-filter predicate. `'any'` matches the union (a hit
 * on either source returns true); `'author'` and `'user'` narrow to
 * the corresponding array. Missing `node.tags` projection (e.g.
 * static fixtures that don't ship tag data) treats the node as
 * having zero tags — the filter does NOT pass.
 */
function nodeMatchesTagFilter(
  n: INodeView,
  filter: { tag: string; source: 'author' | 'user' | 'any' },
): boolean {
  const t = n.tags;
  if (!t) return false;
  if (filter.source === 'author') return t.byAuthor.includes(filter.tag);
  if (filter.source === 'user') return t.byUser.includes(filter.tag);
  return t.byAuthor.includes(filter.tag) || t.byUser.includes(filter.tag);
}

/**
 * Catalog curation 2026-05-07 — sidecar `annotations.stability` is the
 * canonical source; legacy `frontmatter.metadata.stability` is the
 * fallback for un-migrated `.md` files (read through the universal
 * base's `additionalProperties: true`).
 */
function effectiveStability(n: INodeView): TStability | null {
  const ann = n.sidecar?.annotations;
  const fromAnn = ann?.['stability'];
  if (fromAnn === 'stable' || fromAnn === 'experimental' || fromAnn === 'deprecated') {
    return fromAnn;
  }
  const legacy = legacyFrontmatterMetadata(n.frontmatter)?.['stability'];
  if (legacy === 'stable' || legacy === 'experimental' || legacy === 'deprecated') {
    return legacy;
  }
  return null;
}

function nodeHasIssues(n: INodeView): boolean {
  if (effectiveStability(n) === 'deprecated') return true;
  const ann = n.sidecar?.annotations;
  const fromAnn = ann?.['supersededBy'];
  if (typeof fromAnn === 'string' && fromAnn.length > 0) return true;
  const legacy = legacyFrontmatterMetadata(n.frontmatter)?.['supersededBy'];
  return typeof legacy === 'string' && legacy.length > 0;
}

