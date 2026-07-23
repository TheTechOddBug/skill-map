/**
 * Strings of the read-time severity fold (`severity-fold.ts`). Moved
 * here from the server texts catalog when the fold moved into its
 * owning extension (2026-07-23, kernel-agnosticism sweep): the chip
 * tooltip is `core/issue-counter`'s own voice, not the server's. Per
 * severity the tooltip breaks the total down by provenance:
 * deterministic issues ("checks") + findings ("AI findings"). `tx` does
 * not pluralize (see `kernel/util/tx.ts`), so the fold picks the
 * singular / plural leaf per count and interpolates the finished
 * phrases into the parent template. No em dashes.
 *
 * Canonical shape (spec/view-slots.md example): "3 warnings: 2 checks +
 * 1 AI finding".
 */
export const SEVERITY_FOLD_TEXTS = {
  aggregateChipTooltip: '{{total}} {{severity}}: {{checks}} + {{ai}}',
  aggregateChipSeverityWarnSingular: 'warning',
  aggregateChipSeverityWarnPlural: 'warnings',
  aggregateChipSeverityErrorSingular: 'error',
  aggregateChipSeverityErrorPlural: 'errors',
  aggregateChipChecksSingular: '{{count}} check',
  aggregateChipChecksPlural: '{{count}} checks',
  aggregateChipAiSingular: '{{count}} AI finding',
  aggregateChipAiPlural: '{{count}} AI findings',
} as const;
