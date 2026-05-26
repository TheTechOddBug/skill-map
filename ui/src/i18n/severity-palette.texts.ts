/**
 * UI strings for the SeverityPalette component, the graph-view filter
 * palette that toggles visibility of nodes carrying audit findings of
 * a given severity (`error` / `warn`).
 */
export const SEVERITY_PALETTE_TEXTS = {
  a11y: {
    toolbarLabel: 'Toggle severity filters',
  },
  error: {
    label: 'Errors',
    tooltip: 'Only nodes with errors',
  },
  warn: {
    label: 'Warnings',
    tooltip: 'Only nodes with warnings',
  },
} as const;
