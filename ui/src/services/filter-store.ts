/**
 * Cross-view filter state. Kept in a root-level service so the list view,
 * graph view, and (future) inspector-list all read the same filter values
 * without URL coupling. Resetting is a single call.
 *
 * Step 14.5.d, kinds are open per Provider. The "all kinds active"
 * universe is no longer a hardcoded enum; the toggle reads it from the
 * `KindRegistryService` (Provider-declared visual catalog) at call time
 * so a user-plugin Provider that adds a new kind participates in the
 * toggle without code changes here.
 */

import { Injectable, computed, signal } from '@angular/core';
import {
  type TNodeKind,
  type INodeView,
} from '../models/node';
import type { TLinkKindApi } from '../models/api';
import { effectiveUserTags } from '../models/node-derived';

/**
 * Severity tiers surfaced by the severity palette (graph view). Mirrors
 * the `error` / `warn` arm of `IIssueApi.severity` (the `info` tier is
 * filtered out before reaching the card, so it has no filter either).
 */
export type TSeverityFilter = 'error' | 'warn';

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
  /**
   * When true, only nodes whose `isFavorite` is true pass the filter.
   * Visibility of the corresponding toggle button is gated by
   * `CollectionLoaderService.hasAnyFavorites` (the toggle hides while
   * the user has zero favorites).
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
  /**
   * Severity palette toggles (graph view). Independent boolean per
   * tier so the operator can pick `error` only, `warn` only, both, or
   * none. Combination semantics is AND: with both active, only nodes
   * with at least one error AND at least one warn pass; with one
   * active, only nodes with that tier pass; with none active, the
   * filter is bypassed.
   *
   * Live in the shared store (not graph-view local state) so the URL
   * sync layer can deep-link the filter and a future cross-view reset
   * keeps in sync. The actual per-node lookup lives in graph-view
   * (uses `scan.issues.nodeIds`), the store only owns the toggle
   * state.
   */
  private readonly _severityErrorActive = signal<boolean>(false);
  private readonly _severityWarnActive = signal<boolean>(false);

  readonly searchText = this._searchText.asReadonly();
  readonly selectedKinds = this._selectedKinds.asReadonly();
  readonly favoritesOnly = this._favoritesOnly.asReadonly();
  readonly selectedLinkKinds = this._selectedLinkKinds.asReadonly();
  readonly severityErrorActive = this._severityErrorActive.asReadonly();
  readonly severityWarnActive = this._severityWarnActive.asReadonly();
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
      this._favoritesOnly() ||
      this._selectedLinkKinds().length > 0 ||
      this._severityErrorActive() ||
      this._severityWarnActive(),
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

  /** Per-tier severity toggle. AND-combined with sibling tiers downstream. */
  toggleSeverity(tier: TSeverityFilter): void {
    if (tier === 'error') this._severityErrorActive.set(!this._severityErrorActive());
    else this._severityWarnActive.set(!this._severityWarnActive());
  }

  /** True when the severity filter for `tier` is currently on. */
  isSeverityActive(tier: TSeverityFilter): boolean {
    return tier === 'error' ? this._severityErrorActive() : this._severityWarnActive();
  }

  /**
   * Bulk setter for the URL-sync layer. Leaves tiers absent from the
   * input untouched so deep-linking `?severities=error` only flips the
   * error toggle on (matching the multi-select dropdown conventions
   * the kinds / stabilities params use).
   */
  setSeverityFilters(tiers: readonly TSeverityFilter[]): void {
    const set = new Set<TSeverityFilter>(tiers);
    this._severityErrorActive.set(set.has('error'));
    this._severityWarnActive.set(set.has('warn'));
  }

  reset(): void {
    this._searchText.set('');
    this._selectedKinds.set([]);
    this._kindToggleExplicitEmpty.set(false);
    this._favoritesOnly.set(false);
    this._selectedLinkKinds.set([]);
    this._severityErrorActive.set(false);
    this._severityWarnActive.set(false);
  }

  /**
   * Applies the shared filter chain to a list of nodes in declared
   * order: (1) text search over path / name / description; (2) kind
   * membership; (3) favorites; (4) per-tier audit severity. Empty
   * filter values are treated as "allow all".
   *
   * `severityCtx` is consumed by the audit-severity tier filter:
   * callers compute the index once (via `IssuePathsService.bySeverity`)
   * and pass it in. When `severityCtx` is omitted, both severity
   * toggles behave as `allow all` (used by demo harnesses / tests that
   * don't have a scan in scope).
   */
  apply(
    nodes: INodeView[],
    severityCtx?: { errors: ReadonlySet<string>; warns: ReadonlySet<string> },
  ): INodeView[] {
    const text = this.searchText().trim().toLowerCase();
    const kinds = this.selectedKinds();
    const kindsExplicitlyEmpty = this._kindToggleExplicitEmpty();
    const favoritesOnly = this.favoritesOnly();
    const errorActive = this._severityErrorActive();
    const warnActive = this._severityWarnActive();
    const severityActive = (errorActive || warnActive) && severityCtx !== undefined;

    return nodes.filter((n) => {
      if (text) {
        // Tags are single-source (sidecar `annotations.tags`, via
        // `effectiveUserTags`); the former author source
        // (`frontmatter.tags`) was retired.
        const tags = effectiveUserTags(n).join(' ');
        const haystack = [
          n.path,
          n.frontmatter.name ?? '',
          n.frontmatter.description ?? '',
          tags,
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
      if (favoritesOnly && n.isFavorite !== true) return false;
      // AND across the two severity tiers, both on means "node has at
      // least one error AND at least one warn"; one on filters down to
      // nodes carrying that tier.
      if (severityActive) {
        if (errorActive && !severityCtx!.errors.has(n.path)) return false;
        if (warnActive && !severityCtx!.warns.has(n.path)) return false;
      }
      return true;
    });
  }
}

