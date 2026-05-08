/**
 * UI strings for the View contribution system (Phase 4). Per
 * `AGENTS.md` line 40 the project is text-externalized but NOT
 * internationalized — flat object, English-only, no per-locale
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
  /** Renderer-level placeholder — payload validated but missing fields. */
  rendererInvalid: 'Contribution data failed schema validation.',
  /** Renderer-level placeholder — contract not in the UI catalog. */
  rendererUnknownContract: (contract: string) =>
    `Unknown contract: ${contract}. Update the UI to a newer catalog version.`,
  /** Overflow chip shown when a slot exceeds maxItems. */
  overflowBadge: (n: number) => `+${n}`,
  /** Tooltip for the overflow badge. */
  overflowTooltip: (ids: string) => `Hidden: ${ids}`,
} as const;
