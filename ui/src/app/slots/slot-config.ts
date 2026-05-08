/**
 * Phase 4 / View contribution system — closed catalog of UI slots.
 *
 * Slots are UI-only by architectural decision (see `ROADMAP.md` §UI
 * contribution system → "Slots are UI-only"). The kernel does not
 * know about slots; the BFF only knows about contracts. The UI maps
 * `contract → slot(s)` (in `contract-renderer-map.ts`) and renders
 * each slot via the `<sm-view-contributions-host slot="...">` host
 * component.
 *
 * Adding a new slot:
 *   1. Add an entry to `SLOT_REGISTRY` with cardinality / maxItems /
 *      order / strategy.
 *   2. Add the slot id to `TSlotId` (the closed union).
 *   3. Mount `<sm-view-contributions-host slot="<new-id>" ...>` in
 *      the relevant template (inspector / card / graph view).
 *   4. Update `context/view-contributions.md`.
 *
 * See [`context/view-contributions.md`](../../../../context/view-contributions.md)
 * for the operating guide and the data-testid convention.
 */

/**
 * Closed enum of slot ids. Every slot the UI exposes for view
 * contributions appears here. Adding a member is a UI-side change
 * (no spec / kernel coordination needed) but should be discussed in
 * `ROADMAP.md` first because it affects the contract→slot mapping.
 */
export type TSlotId =
  | 'card.chip'
  | 'inspector.body'
  | 'inspector.header.badge'
  | 'graph.node.marker'
  | 'topbar.indicator';

/**
 * Per-slot configuration. The host component reads this to know
 * how to merge multiple contributions targeting the same slot:
 * order, cap, replace strategy.
 */
export interface ISlotConfig {
  id: TSlotId;
  /**
   * `single` — at most one contribution; competing emissions trigger
   * `strategy: 'replace-with-warning'`. `multi` — many contributions
   * coexist, ordered by `order`, capped at `maxItems` (overflow
   * collapses into `+N`).
   */
  cardinality: 'single' | 'multi';
  /** Max contributions visible at once. Overflow folds into `+N`. */
  maxItems: number;
  /**
   * Stable order for `multi` slots. `alphabetical` sorts by
   * qualified id; `fifo` keeps the kernel's emission order;
   * `priority` is reserved for a future per-contribution priority
   * field (today no contracts declare priority).
   */
  order: 'alphabetical' | 'fifo' | 'priority';
  /**
   * What happens when a `single` slot has multiple emissions, OR
   * when a `multi` slot exceeds `maxItems`.
   *   - `append` — multi slots overflow to `+N`; single slots last-load-wins.
   *   - `replace-with-warning` — emit a console warning per slot per scan
   *     and let last-load-wins.
   */
  strategy: 'append' | 'replace-with-warning';
}

/**
 * The catalog. Order in this object reflects "natural" insertion
 * order across the UI (top-down: topbar, inspector header, body,
 * card, graph) for readability; runtime dispatch is keyed by id.
 */
export const SLOT_REGISTRY: Record<TSlotId, ISlotConfig> = {
  'topbar.indicator': {
    id: 'topbar.indicator',
    cardinality: 'multi',
    maxItems: 3,
    order: 'alphabetical',
    strategy: 'append',
  },
  'inspector.header.badge': {
    id: 'inspector.header.badge',
    cardinality: 'multi',
    maxItems: 4,
    order: 'alphabetical',
    strategy: 'append',
  },
  'inspector.body': {
    id: 'inspector.body',
    cardinality: 'multi',
    maxItems: 50,
    order: 'alphabetical',
    strategy: 'append',
  },
  'card.chip': {
    id: 'card.chip',
    cardinality: 'multi',
    maxItems: 5,
    order: 'alphabetical',
    strategy: 'append',
  },
  'graph.node.marker': {
    id: 'graph.node.marker',
    cardinality: 'multi',
    maxItems: 1,
    order: 'alphabetical',
    strategy: 'append',
  },
};

/** Lookup helper. */
export function slotConfig(id: TSlotId): ISlotConfig {
  return SLOT_REGISTRY[id];
}
