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
   * Section headers the inspector body renders directly. Vendor-frontmatter
   * sub-sections (Behavior / Capabilities / Initial prompt) own their own
   * catalog so each renderer stays self-contained.
   */
  sections: {
    annotations: 'Annotations',
    connections: 'Connections',
    findings: 'Findings',
    audit: 'Audit',
    plugins: 'Plugin contributions',
    viewContributions: 'View contributions',
    debug: 'Debug',
    body: 'Body',
  },
  body: {
    loading: 'Loading body…',
    empty: 'This file has no body content (only frontmatter).',
    unavailable: 'Body content unavailable. The source file may have moved or been deleted since the last scan.',
    renderError: 'Failed to render markdown body.',
    refreshLabel: 'Refresh body',
  },
  /** Step 9.6.5, bump button + consent dialog. */
  bump: {
    label: 'Bump version',
    tooltipEnabled: 'Increment the sidecar version and refresh hashes.',
    tooltipDisabledFresh: 'No drift detected (bump is only available when the body or frontmatter has changed since the last bump).',
    errorPrefix: 'Bump failed:',
    errorFresh: 'This node is fresh; nothing to bump.',
    errorNotFound: 'Node not found on the server.',
    errorGeneric: 'Could not bump the sidecar.',
    consentHeader: 'Save extra info alongside your files?',
    consentMessage:
      'Skill-map can keep a small companion file (*.sm) next to each of your ' +
      'markdown files. It tracks version, history and tags so you can see how ' +
      'each one evolves over time.\n\n' +
      'We use a separate `.sm` file so your markdown stays clean, no ' +
      "metadata gets mixed into the content you wrote.\n\n" +
      'Your preference stays on your computer, it does not travel with the ' +
      "project, and we won't ask again.",
    consentAccept: 'Yes, allow',
    consentReject: 'Not now',
    consentDialogAriaLabel: 'Sidecar consent',
  },
  /** Stats footer, single inline line under the body. */
  stats: {
    bytes: 'bytes',
    tokens: 'tokens',
    out: 'out',
    in: 'in',
    ext: 'external',
  },
  /** Findings list, fix hint label rendered before the per-issue summary. */
  findingHintLabel: 'Hint:',
  /** Aria label for the bump-error toast dismiss button. */
  bumpErrorDismissAriaLabel: 'Dismiss',
  /**
   * Catalog curation (2026-05-07), collapsible audit summary line. The
   * header surfaces the most-recent activity inline so the user does not
   * have to expand to see it.
   */
  audit: {
    headerSummary: (rel: string, by: string) => `last bumped ${rel} by ${by}`,
    headerEmpty: 'never bumped',
    fields: {
      lastBumpedAt: 'Last bumped',
      lastBumpedBy: 'by',
      createdAt: 'Created',
      createdBy: 'by',
    },
  },
  /** Banner shown when `annotations.supersededBy` is set. */
  supersededByBanner: (path: string) => `Superseded by ${path}`,
  /** Aria + tooltip for the debug toggle that sits in the toolbar. */
  debugToggleAriaLabel: 'Toggle debug panel',
  debugToggleTooltip: 'Show diagnostic fields (hash diffs, resolved provider/kind, sidecar status enum).',
  /**
   * TEMPORARY plugin-actions row mocks while the BFF surface for runnable
   * verbs is being designed. Gated by the `inspector.actionMocks` setting
   * (default OFF), the labels stay in the catalog so the convention does
   * not erode.
   */
  actionMocks: {
    label: 'Actions',
    summary: 'Generate summary',
    audit: 'Run audit',
    validate: 'Validate',
  },
  /** Embedded-mode close button. */
  close: {
    label: 'Close',
    tooltip: 'Close inspector',
  },
} as const;
