/**
 * Cross-view filter state. Kept in a root-level service so the list view,
 * graph view, and (future) inspector-list all read the same filter values
 * without URL coupling. Resetting is a single call.
 *
 * Step 14.5.d, kinds are open per Provider. The "all kinds active"
 * universe is no longer a hardcoded enum; the toggle reads it from the
 * `KindRegistryService` (Provider-declared visual catalog) at call time
 * so a user-plugin Provider that adds a new kind participates in the
 * toggle / filter-bar without code changes here.
 */

import { Injectable, computed, signal } from '@angular/core';
import {
  isStaleSidecar,
  type TNodeKind,
  type INodeView,
  type TStability,
} from '../models/node';
import type { TLinkKindApi } from '../models/api';
import { effectiveStability, effectiveSupersededBy } from '../models/node-derived';

export const ALL_STABILITIES: readonly TStability[] = ['stable', 'experimental', 'deprecated'];

/**
 * Closed catalog of link kinds, mirrors `spec/schemas/link.schema.json`
 * `properties.kind.enum`. Link kinds are spec-fixed (unlike node kinds,
 * which are open per Provider), so the universe is a constant here and
 * the toggle logic in `toggleLinkKind` does not consult any registry.
 */
export const ALL_LINK_KINDS: readonly TLinkKindApi[] = [
  'invokes',
  'references',
  'mentions',
  'supersedes',
];

@Injectable({ providedIn: 'root' })
export class FilterStoreService {
  private readonly _searchText = signal<string>('');
  private readonly _selectedKinds = signal<TNodeKind[]>([]);
  /**
   * Sticky flag for the toggle-palette path. Set to `true` when the
   * operator deactivates the LAST visible kind via `toggleKind`, so the
   * graph stays empty instead of normalising back to "no filter, all
   * visible" (the latter is the default initial state, ambiguous with
   * "user explicitly turned everything off"). Cleared when:
   *   - the operator re-activates any kind (back to a meaningful whitelist),
   *   - `reset()` runs,
   *   - the multi-select dropdown path emits a new value (the dropdown
   *     widget conventions stay "empty = no filter" so it doesn't enter
   *     this sticky state).
   */
  private readonly _kindToggleExplicitEmpty = signal<boolean>(false);
  private readonly _selectedStabilities = signal<TStability[]>([]);
  private readonly _hasIssuesOnly = signal<boolean>(false);
  /**
   * Step 9.6.5, when true, only nodes whose sidecar overlay is in the
   * "stale" set (`stale-body` / `stale-frontmatter` / `stale-both`)
   * pass the filter. Nodes with no sidecar OR with a `fresh` overlay
   * are filtered out.
   */
  private readonly _staleOnly = signal<boolean>(false);
  /**
   * When true, only nodes whose `isFavorite` is true pass the filter.
   * Visibility of the corresponding toggle button in the filter-bar is
   * gated by `CollectionLoaderService.hasAnyFavorites` (the toggle
   * hides while the user has zero favorites, see the filter-bar
   * template for the exact visibility rule).
   */
  private readonly _favoritesOnly = signal<boolean>(false);
  /**
   * Link-kind whitelist for the graph view. Same semantics as
   * `_selectedKinds`: empty array means "no filter / all link kinds
   * visible"; non-empty array is a whitelist of edge kinds to keep on
   * the canvas. The list view ignores this signal, edges only render
   * in the graph.
   */
  private readonly _selectedLinkKinds = signal<TLinkKindApi[]>([]);

  readonly searchText = this._searchText.asReadonly();
  readonly selectedKinds = this._selectedKinds.asReadonly();
  readonly selectedStabilities = this._selectedStabilities.asReadonly();
  readonly hasIssuesOnly = this._hasIssuesOnly.asReadonly();
  readonly staleOnly = this._staleOnly.asReadonly();
  readonly favoritesOnly = this._favoritesOnly.asReadonly();
  readonly selectedLinkKinds = this._selectedLinkKinds.asReadonly();
  /**
   * Read-only mirror of the sticky "operator turned every kind toggle
   * off" flag. The graph view consumes this to keep rendering the empty
   * canvas instead of the "No nodes match" message: the graph staying
   * visible (without nodes) is the user's preferred visualization for
   * this state. See `toggleKind` for the lifecycle of the sticky flag.
   */
  readonly kindToggleExplicitEmpty = this._kindToggleExplicitEmpty.asReadonly();

  readonly isActive = computed(
    () =>
      this._searchText().trim().length > 0 ||
      this._selectedKinds().length > 0 ||
      this._kindToggleExplicitEmpty() ||
      this._selectedStabilities().length > 0 ||
      this._hasIssuesOnly() ||
      this._staleOnly() ||
      this._favoritesOnly() ||
      this._selectedLinkKinds().length > 0,
  );

  setSearchText(value: string): void {
    this._searchText.set(value);
  }

  setKinds(kinds: TNodeKind[]): void {
    // Multi-select dropdown semantic: empty array = "no filter active"
    // (widget convention). The sticky explicit-empty state belongs to
    // the toggle palette path only; resetting it here keeps the two UIs
    // from contradicting each other when the operator pokes both.
    this._kindToggleExplicitEmpty.set(false);
    this._selectedKinds.set([...kinds]);
  }

  /**
   * Toggle a single kind. Semantics align with `apply()`:
   *   - empty `selectedKinds` array = "no kind filter" = all kinds active.
   *   - non-empty array = whitelist; only listed kinds pass.
   * The toggle treats the caller-supplied `universe` (kinds the caller
   * actually surfaces in its UI) as the starting point, flips the
   * requested kind, and normalises back to the empty array when every
   * kind is on. `universe` MUST be the kinds the caller displays
   * toggles for; passing the full registry would let a kind with zero
   * loaded nodes survive in `startSet`, so turning off every visible
   * toggle would leave `selectedKinds = [<invisible-kind>]` and the
   * filter would treat it as a whitelist with zero matches.
   */
  toggleKind(kind: TNodeKind, universe: readonly TNodeKind[]): void {
    const sel = this._selectedKinds();
    const u = universe;
    const explicitEmpty = this._kindToggleExplicitEmpty();
    // When we are in "explicit empty" mode, the visible whitelist is
    // effectively empty (every toggle reads OFF); a click must start
    // from `{}` and add ONLY the requested kind, not from the full
    // universe. Otherwise (default / partial state), an empty `sel`
    // means "no filter" and the toggle starts from the full universe
    // so removing one kind narrows the visible set as expected.
    const startSet = explicitEmpty
      ? new Set<TNodeKind>()
      : sel.length === 0
        ? new Set<TNodeKind>(u)
        : new Set(sel);
    if (startSet.has(kind)) {
      startSet.delete(kind);
    } else {
      startSet.add(kind);
    }
    if (startSet.size === u.length) {
      // Every visible kind is selected → normalise back to "no filter".
      this._selectedKinds.set([]);
      this._kindToggleExplicitEmpty.set(false);
    } else if (startSet.size === 0) {
      // Operator turned the LAST kind off → stay in explicit-empty,
      // graph renders empty instead of re-enabling every toggle.
      this._selectedKinds.set([]);
      this._kindToggleExplicitEmpty.set(true);
    } else {
      this._selectedKinds.set([...startSet]);
      this._kindToggleExplicitEmpty.set(false);
    }
  }

  /** True when the kind is currently visible (passes the kind filter). */
  isKindActive(kind: TNodeKind): boolean {
    if (this._kindToggleExplicitEmpty()) return false;
    const sel = this._selectedKinds();
    if (sel.length === 0) return true;
    return sel.includes(kind);
  }

  setStabilities(stabilities: TStability[]): void {
    this._selectedStabilities.set([...stabilities]);
  }

  setHasIssuesOnly(value: boolean): void {
    this._hasIssuesOnly.set(value);
  }

  setStaleOnly(value: boolean): void {
    this._staleOnly.set(value);
  }

  setFavoritesOnly(value: boolean): void {
    this._favoritesOnly.set(value);
  }

  setLinkKinds(kinds: TLinkKindApi[]): void {
    this._selectedLinkKinds.set([...kinds]);
  }

  /**
   * Toggle a single link kind. Same normalisation as `toggleKind`: the
   * empty-array state means "all kinds visible", so when every kind is
   * checked the signal collapses back to `[]` to keep `isActive` clean.
   */
  toggleLinkKind(kind: TLinkKindApi): void {
    const sel = this._selectedLinkKinds();
    const startSet =
      sel.length === 0 ? new Set<TLinkKindApi>(ALL_LINK_KINDS) : new Set(sel);
    if (startSet.has(kind)) {
      startSet.delete(kind);
    } else {
      startSet.add(kind);
    }
    if (startSet.size === ALL_LINK_KINDS.length) {
      this._selectedLinkKinds.set([]);
    } else {
      this._selectedLinkKinds.set([...startSet]);
    }
  }

  /** True when the link kind currently passes the edge filter. */
  isLinkKindActive(kind: TLinkKindApi): boolean {
    const sel = this._selectedLinkKinds();
    if (sel.length === 0) return true;
    return sel.includes(kind);
  }

  reset(): void {
    this._searchText.set('');
    this._selectedKinds.set([]);
    this._kindToggleExplicitEmpty.set(false);
    this._selectedStabilities.set([]);
    this._hasIssuesOnly.set(false);
    this._staleOnly.set(false);
    this._favoritesOnly.set(false);
    this._selectedLinkKinds.set([]);
  }

  /**
   * Applies all three filters to a list of nodes in declared order:
   * (1) text search over path / name / description; (2) kind membership;
   * (3) stability membership. Empty filter values are treated as "allow all".
   */
  apply(nodes: INodeView[]): INodeView[] {
    const text = this.searchText().trim().toLowerCase();
    const kinds = this.selectedKinds();
    const kindsExplicitlyEmpty = this._kindToggleExplicitEmpty();
    const stabilities = this.selectedStabilities();
    const issuesOnly = this.hasIssuesOnly();
    const staleOnly = this.staleOnly();
    const favoritesOnly = this.favoritesOnly();

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
      // Sticky "explicit empty" wins over the empty-as-no-filter
      // convention: the operator deliberately turned everything off via
      // the toggle palette, so the graph should render zero nodes.
      if (kindsExplicitlyEmpty) return false;
      if (kinds.length > 0 && !kinds.includes(n.kind)) return false;
      if (stabilities.length > 0) {
        const s = effectiveStability(n);
        if (!s || !stabilities.includes(s)) return false;
      }
      if (issuesOnly && !nodeHasIssues(n)) return false;
      if (staleOnly && !isStaleSidecar(n.sidecar)) return false;
      if (favoritesOnly && n.isFavorite !== true) return false;
      return true;
    });
  }
}

function nodeHasIssues(n: INodeView): boolean {
  if (effectiveStability(n) === 'deprecated') return true;
  return effectiveSupersededBy(n) !== null;
}

