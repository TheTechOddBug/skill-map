/**
 * View contribution system — closed catalog of UI slots.
 *
 * Slots are spec-level (kernel + UI consensus): the plugin manifest
 * picks a slot directly, the kernel validates the payload against the
 * slot's shape, the UI mounts a host per slot in the templates. There
 * is no separate "contract" abstraction.
 *
 * Adding a new slot:
 *   1. Update `spec/schemas/view-slots.schema.json` (the source of
 *      truth) and the kernel's `TSlotName` mirror.
 *   2. Add the slot id to `TSlotId` (the closed UI union).
 *   3. Add an entry to `SLOT_REGISTRY` with cardinality / maxItems /
 *      order / strategy.
 *   4. Add the slot → renderer mapping in `slot-renderer-map.ts`.
 *   5. Mount `<sm-view-contributions-host slot="<new-id>" ...>` in
 *      the relevant template (inspector / card / graph view).
 *   6. Update `context/view-contributions.md`.
 *
 * See [`context/view-contributions.md`](../../../../context/view-contributions.md)
 * for the operating guide and the data-testid convention.
 */

/**
 * Closed enum of slot ids. Mirror of the kernel's `TSlotName`. 15
 * entries covering the 5 monomorphic legacy slots plus the 10
 * sub-slots that replaced the 3 polymorphic ones (one sub-slot per
 * payload shape).
 */
export type TSlotId =
  | 'card.title.right'
  | 'card.subtitle.left'
  | 'card.footer.left.counter'
  | 'card.footer.right'
  | 'graph.node.alert'
  | 'inspector.header.badge.counter'
  | 'inspector.header.badge.tag'
  | 'inspector.body.panel.breakdown'
  | 'inspector.body.panel.records'
  | 'inspector.body.panel.tree'
  | 'inspector.body.panel.key-values'
  | 'inspector.body.panel.link-list'
  | 'inspector.body.panel.markdown'
  | 'topbar.actions.indicator';

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
   * `priority` reads `IViewContribution.priority` from the manifest
   * (default 100, ASC), tie-breaks alphabetically.
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
  /**
   * Whether this slot honours the contribution's `severity` field for
   * presentation (tinting). Default `true`. Set to `false` when the
   * slot wants neutral visuals regardless of what the plugin emitted —
   * e.g. an analytic counter where severity is data, not a UI cue.
   * The host strips `severity` from the payload before forwarding it
   * to the renderer when this is `false`.
   */
  respectSeverity?: boolean;
}

/**
 * The catalog. Order in this object reflects "natural" insertion
 * order across the UI (top-down: topbar, inspector header, body,
 * card, graph) for readability; runtime dispatch is keyed by id.
 *
 * Sub-slots (`*.counter`, `*.tag`, `inspector.body.panel.*`) inherit
 * the maxItems / order / respectSeverity profile of their former
 * polymorphic parent so visual behaviour stays consistent post-split.
 */
export const SLOT_REGISTRY: Record<TSlotId, ISlotConfig> = {
  'topbar.actions.indicator': {
    id: 'topbar.actions.indicator',
    cardinality: 'multi',
    maxItems: 3,
    order: 'alphabetical',
    strategy: 'append',
  },
  'inspector.header.badge.counter': {
    id: 'inspector.header.badge.counter',
    cardinality: 'multi',
    maxItems: 4,
    order: 'alphabetical',
    strategy: 'append',
  },
  'inspector.header.badge.tag': {
    id: 'inspector.header.badge.tag',
    cardinality: 'multi',
    maxItems: 4,
    order: 'alphabetical',
    strategy: 'append',
  },
  'inspector.body.panel.breakdown': {
    id: 'inspector.body.panel.breakdown',
    cardinality: 'multi',
    maxItems: 50,
    order: 'alphabetical',
    strategy: 'append',
  },
  'inspector.body.panel.records': {
    id: 'inspector.body.panel.records',
    cardinality: 'multi',
    maxItems: 50,
    order: 'alphabetical',
    strategy: 'append',
  },
  'inspector.body.panel.tree': {
    id: 'inspector.body.panel.tree',
    cardinality: 'multi',
    maxItems: 50,
    order: 'alphabetical',
    strategy: 'append',
  },
  'inspector.body.panel.key-values': {
    id: 'inspector.body.panel.key-values',
    cardinality: 'multi',
    maxItems: 50,
    order: 'alphabetical',
    strategy: 'append',
  },
  'inspector.body.panel.link-list': {
    id: 'inspector.body.panel.link-list',
    cardinality: 'multi',
    maxItems: 50,
    order: 'alphabetical',
    strategy: 'append',
  },
  'inspector.body.panel.markdown': {
    id: 'inspector.body.panel.markdown',
    cardinality: 'multi',
    maxItems: 50,
    order: 'alphabetical',
    strategy: 'append',
  },
  'card.footer.left.counter': {
    id: 'card.footer.left.counter',
    cardinality: 'multi',
    maxItems: 5,
    order: 'priority',
    strategy: 'append',
    respectSeverity: true,
  },
  'card.footer.right': {
    id: 'card.footer.right',
    cardinality: 'multi',
    maxItems: 5,
    order: 'priority',
    strategy: 'append',
    respectSeverity: true,
  },
  'card.subtitle.left': {
    id: 'card.subtitle.left',
    cardinality: 'multi',
    maxItems: 3,
    order: 'priority',
    strategy: 'append',
    respectSeverity: true,
  },
  'card.title.right': {
    id: 'card.title.right',
    cardinality: 'multi',
    maxItems: 2,
    order: 'priority',
    strategy: 'append',
    respectSeverity: true,
  },
  'graph.node.alert': {
    id: 'graph.node.alert',
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
