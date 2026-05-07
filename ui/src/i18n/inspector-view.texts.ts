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
  cards: {
    agent: 'Agent',
    relations: 'Relations',
    metadata: 'Metadata',
    tools: 'Tools',
    external: 'External',
    body: 'Body',
  },
  /**
   * Per-field labels surfaced in the inspector. After catalog curation
   * 2026-05-07 the inspector defers per-field rendering to specialised
   * sub-components (annotations panel, vendor frontmatter, audit panel
   * — each owns its own labels). The remaining entries here cover
   * legacy strings that earlier inspector cards used; trim further as
   * those surfaces migrate to their owners.
   */
  fields: {
    model: 'Model',
    supersededBy: 'Superseded by',
    supersedes: 'Supersedes',
    requires: 'Requires',
    related: 'Related',
    conflictsWith: 'Conflicts with',
    tags: 'Tags',
    toolsAllowlist: 'Tools (allowlist)',
    'allowed-tools': 'Allowed tools (pre-approved)',
    source: 'Source',
    docs: 'Docs',
    version: 'Version',
    authors: 'Authors',
    license: 'License',
  },
  body: {
    loading: 'Loading body…',
    empty: 'This file has no body content (only frontmatter).',
    unavailable: 'Body content unavailable — the source file may have moved or been deleted since the last scan.',
    renderError: 'Failed to render markdown body.',
    refreshLabel: 'Refresh body',
  },
  /** Strings for the dead-link verify icon on relation chips (Step 14.5.b). */
  relations: {
    verifyHint: 'This path is not in the current scan scope. Click to check whether the file exists.',
    deadConfirmed: 'Verified: this path does not resolve to a known node.',
  },
  authorsSeparator: ', ',
  missing: '—',
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
