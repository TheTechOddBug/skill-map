/** UI strings for the InspectorView. */
export const INSPECTOR_VIEW_TEXTS = {
  emptyNoSelection: {
    title: 'No node selected',
    descPrefix: 'Pick a node from the ',
    listLink: 'list',
    descMiddle: ' or ',
    graphLink: 'graph',
    descSuffix: '.',
  },
  emptyNotFound: {
    title: 'Node not found',
    descSuffix: ' does not exist in the collection. ',
    backLink: 'Back to list',
    descAfterLink: '.',
  },
  backToList: '← back to list',
  /**
   * Card headers used by the inspector view itself. Per-field labels
   * for vendor frontmatter / annotations / debug / audit are owned by
   * each sub-component's own i18n table — this surface only carries
   * the two headers the inspector renders directly (the agent vendor
   * card and the body card), plus the standalone annotations card
   * header (`cardsAnnotations` below).
   */
  cards: {
    agent: 'Agent',
    body: 'Body',
  },
  body: {
    loading: 'Loading body…',
    empty: 'This file has no body content (only frontmatter).',
    unavailable: 'Body content unavailable — the source file may have moved or been deleted since the last scan.',
    renderError: 'Failed to render markdown body.',
    refreshLabel: 'Refresh body',
  },
  /** Placeholder cards for v0.8.0 features (enrichment, summary, findings). */
  placeholders: {
    enrichmentTitle: 'Enrichment',
    summaryTitle: 'Summary',
    findingsTitle: 'Findings',
    body: 'Available in v0.8.0',
  },
  /** Step 9.6.5 — annotations card + bump button. */
  cardsAnnotations: 'Annotations',
  bump: {
    label: 'Bump version',
    tooltipEnabled: 'Increment the sidecar version and refresh hashes.',
    tooltipDisabledFresh: 'No drift detected — bump is only available when the body or frontmatter has changed since the last bump.',
    errorPrefix: 'Bump failed:',
    errorFresh: 'This node is fresh; nothing to bump.',
    errorNotFound: 'Node not found on the server.',
    errorGeneric: 'Could not bump the sidecar.',
  },
  /**
   * Catalog curation (2026-05-07) — collapsible section headers and the
   * audit summary line. The audit header surfaces the most-recent
   * activity inline so the user doesn't have to expand to see it.
   */
  audit: {
    header: 'Audit',
    headerSummary: (rel: string, by: string) => `last bumped ${rel} by ${by}`,
    headerEmpty: 'never bumped',
    fields: {
      lastBumpedAt: 'Last bumped',
      lastBumpedBy: 'by',
      createdAt: 'Created',
      createdBy: 'by',
    },
  },
  /**
   * Banner shown on the card when `annotations.supersededBy` is set —
   * caps the marker phrase for the inspector header version line.
   */
  supersededByBanner: (path: string) => `Superseded by ${path}`,
  /** Aria + tooltip for the inline debug toggle button in the header. */
  debugToggleAriaLabel: 'Toggle debug panel',
  debugToggleTooltip: 'Show diagnostic fields (hash diffs, resolved provider/kind, sidecar status enum).',
} as const;
