/**
 * UI strings for the View contribution system. Per
 * `AGENTS.md` line 40 the project is text-externalized but NOT
 * internationalized, flat object, English-only, no per-locale
 * records. See [`AGENTS.md`](../../../AGENTS.md) §"Externalized
 * texts, not internationalized".
 */
export const VIEW_CONTRIBUTIONS_TEXTS = {
  /** Heading for the inspector body grouping panel. */
  panelHeader: 'Plugin contributions',
  /** Pluralized count appended to the panel header. */
  panelCount: (n: number) => `${n} contribution${n === 1 ? '' : 's'}`,
  /** Empty state shown when the slot has no contributions for this node. */
  emptyDefault: 'No contributions for this node.',
  /** Renderer-level placeholder, payload validated but missing fields. */
  rendererInvalid: 'Contribution data failed schema validation.',
  /** Renderer-level placeholder, slot not in the UI catalog. */
  rendererUnknownSlot: (slot: string) =>
    `Unknown slot: ${slot}. Update the UI to a newer catalog version.`,
  /** Overflow chip shown when a slot exceeds maxItems. */
  overflowBadge: (n: number) => `+${n}`,
  /** Tooltip for the overflow badge. */
  overflowTooltip: (ids: string) => `Hidden: ${ids}`,
  /**
   * Aria labels for the boolean cell glyphs rendered by `<sm-node-records>`.
   * Visuals are PrimeIcons (`pi-check` / `pi-minus`); screen readers
   * fall back to these labels.
   */
  recordsCell: {
    boolTrue: 'yes',
    boolFalse: 'no',
  },
} as const;
