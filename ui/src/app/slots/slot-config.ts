/**
 * View contribution system, closed catalog of UI slots.
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
 * entries: 5 card slots (`card.*` + `graph.node.alert`), one unified
 * inspector header badge slot, one inspector action-button slot, 6
 * inspector body panel sub-slots, one plugin-owned inspector body
 * section slot, and the topbar nav slot.
 */
export type TSlotId =
  | 'card.title.right'
  | 'card.subtitle.left'
  | 'card.footer.left'
  | 'card.footer.right'
  | 'graph.node.alert'
  | 'inspector.header.badge'
  | 'inspector.action.button'
  | 'inspector.body.panel.breakdown'
  | 'inspector.body.panel.records'
  | 'inspector.body.panel.tree'
  | 'inspector.body.panel.key-values'
  | 'inspector.body.panel.link-list'
  | 'inspector.body.panel.markdown'
  | 'inspector.body.section'
  | 'topbar.nav.start';

/**
 * Per-slot configuration. The host component reads this to know
 * how to merge multiple contributions targeting the same slot:
 * order, cap, replace strategy.
 */
export interface ISlotConfig {
  id: TSlotId;
  /**
   * `single`, at most one contribution; competing emissions trigger
   * `strategy: 'replace-with-warning'`. `multi`, many contributions
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
   * (default 100, ASC), tie-breaks alphabetically; `severity` ranks
   * the contribution's payload `severity` (`danger` > `warn` > `info`
   * > `success`, missing severity sorts last), tie-breaks
   * alphabetically. Use `severity` on single-emission slots where the
   * worst issue wins (e.g. corner alerts).
   */
  order: 'alphabetical' | 'fifo' | 'priority' | 'severity';
  /**
   * What happens when a `single` slot has multiple emissions, OR
   * when a `multi` slot exceeds `maxItems`.
   *   - `append`, multi slots overflow to `+N`; single slots last-load-wins.
   *   - `replace-with-warning`, emit a console warning per slot per scan
   *     and let last-load-wins.
   */
  strategy: 'append' | 'replace-with-warning';
  /**
   * Whether this slot honours the contribution's `severity` field for
   * presentation (tinting). Default `true`. Set to `false` when the
   * slot wants neutral visuals regardless of what the plugin emitted,
   * e.g. an analytic counter where severity is data, not a UI cue.
   * The host strips `severity` from the payload before forwarding it
   * to the renderer when this is `false`.
   */
  respectSeverity?: boolean;
  /**
   * When the slot caps at fewer items than emitted, render the `+N`
   * overflow badge next to the visible ones? Default `true` (badge
   * shows so the user knows something is hidden). Set `false` for
   * decoration-only slots (e.g. a single corner alert) where the
   * extra badge would be visual clutter, the cap silently picks
   * the winner per the `order` rule, the rest are suppressed.
   */
  showOverflowBadge?: boolean;
  /**
   * How the host lays out the contributions in this slot.
   *   - `inline` (default), an inline-flex cluster (chips, counters,
   *     badges) that wraps within the parent's content box.
   *   - `stack`, a full-width vertical column, one contribution per
   *     row. Used by slots whose renderer paints block-level chrome
   *     (e.g. `inspector.body.section`, where each contribution is its
   *     own collapsible section), so the items never sit side by side.
   */
  layout?: 'inline' | 'stack';
}

/**
 * The catalog. Order in this object reflects "natural" insertion
 * order across the UI (top-down: topbar, inspector header, body,
 * card, graph) for readability; runtime dispatch is keyed by id.
 *
 * The body-panel sub-slots (`inspector.body.panel.*`) inherit the
 * maxItems / order / respectSeverity profile of their former
 * polymorphic parent so visual behaviour stays consistent post-split.
 * The unified `inspector.header.badge` slot uses the
 * `card.footer.left` profile (priority order, severity-aware) since
 * the generic badge is modelled on the card footer cluster.
 */
export const SLOT_REGISTRY: Record<TSlotId, ISlotConfig> = {
  'topbar.nav.start': {
    id: 'topbar.nav.start',
    cardinality: 'multi',
    maxItems: 3,
    order: 'alphabetical',
    strategy: 'append',
  },
  'inspector.header.badge': {
    id: 'inspector.header.badge',
    cardinality: 'multi',
    maxItems: 4,
    order: 'priority',
    strategy: 'append',
    respectSeverity: true,
  },
  'inspector.action.button': {
    id: 'inspector.action.button',
    cardinality: 'multi',
    maxItems: 6,
    order: 'priority',
    strategy: 'append',
    respectSeverity: true,
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
  'inspector.body.section': {
    // Plugin-owned collapsible zones in the inspector body. Each
    // contribution paints its OWN `<sm-collapsible-section>` titled
    // `<pluginId>:<zone>` (the prefix is host-applied for non-system
    // plugins, never trusted from the payload). Multi-cardinality so
    // several plugins (and several zones per plugin) can each get a
    // section; capped at 10 so a misbehaving plugin cannot flood the
    // inspector. Priority order lets a plugin hint where its zone sits
    // relative to others, tie-breaking alphabetically by qualified id.
    id: 'inspector.body.section',
    cardinality: 'multi',
    maxItems: 10,
    order: 'priority',
    strategy: 'append',
    layout: 'stack',
  },
  'card.footer.left': {
    id: 'card.footer.left',
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
    // Reserved slot: the catalog keeps this surface available for
    // genuinely special, independent signals (e.g. a future plugin
    // that wants a corner decoration tied to a one-off condition), but
    // NO built-in core analyzer emits here. Generic "this node has a
    // problem" signals belong in `card.footer.right`, where a chip
    // pairs the icon with a count without competing for the limited
    // corner real-estate. When deciding whether to emit here, ask:
    // "is this signal independent of every other finding on the node,
    // and does it deserve the only decoration the corner allows?"
    // If not, use a chip. The `order: 'severity'` + `maxItems: 1`
    // policy is kept defensively: if two emitters ever land on the
    // same node, the worst severity claims the corner and the rest
    // are suppressed silently (no `+N` badge).
    order: 'severity',
    strategy: 'append',
    showOverflowBadge: false,
  },
};

/** Lookup helper. */
export function slotConfig(id: TSlotId): ISlotConfig {
  return SLOT_REGISTRY[id];
}
