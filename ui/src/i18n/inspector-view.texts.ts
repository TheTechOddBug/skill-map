/** UI strings for the InspectorView. */
export const INSPECTOR_VIEW_TEXTS = {
  emptyNoSelection: {
    title: 'No node selected',
    desc: 'Select a node to inspect it.',
  },
  emptyNotFound: {
    title: 'Node not found',
    descSuffix: ' This node is no longer in the scan.',
  },
  /**
   * Header badge shown when a node's frontmatter failed to parse (the
   * `frontmatter-parse-error` analyzer fired). The title falls back to
   * the file name and this badge explains why name / description /
   * metadata are missing.
   */
  header: {
    invalidFrontmatter: 'invalid frontmatter',
    invalidFrontmatterTooltip:
      'The YAML frontmatter could not be parsed, so name, description and other metadata are unavailable. Check the Findings section for the parser error.',
  },
  /**
   * Section headers the inspector body renders directly. Vendor-frontmatter
   * sub-sections (Behavior / Capabilities / Initial prompt) own their own
   * catalog so each renderer stays self-contained.
   */
  sections: {
    annotations: 'Annotations',
    connections: 'Connections',
    findings: 'Findings',
    audit: 'Metadata',
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
  },
  /** Step 9.6.5, bump button + consent dialog. */
  bump: {
    label: 'Bump version',
    tooltipEnabled: 'Increment the sidecar version and refresh hashes.',
    tooltipDisabledFresh: 'No drift detected (bump is only available when the body or frontmatter has changed since the last bump).',
    tooltipDisabledNoSidecar: 'No sidecar yet. Run `sm sidecar annotate <path>` from your terminal to create one.',
    errorPrefix: 'Bump failed:',
    errorFresh: 'This node is fresh; nothing to bump.',
    errorNotFound: 'Node not found on the server.',
    errorGeneric: 'Could not bump the sidecar.',
    consentHeader: 'Allow skill-map to create files in this project?',
    consentMessage:
      'Skill-map will create companion files (*.sm) next to your markdown ' +
      'files to track version, history and tags. Your markdown stays clean, ' +
      'metadata never gets mixed into the content you wrote.\n\n' +
      'The choice is per-project and per-machine, it does not travel with ' +
      "the repo, and we won't ask again.",
    consentAccept: 'Yes, allow',
    consentReject: 'Not now',
    consentDialogAriaLabel: 'Sidecar consent',
  },
  /** Findings list, fix hint label rendered before the per-issue summary. */
  findingHintLabel: 'Hint:',
  /** Aria label for the bump-error toast dismiss button. */
  bumpErrorDismissAriaLabel: 'Dismiss',
  /**
   * Metadata section (the `audit:` sidecar block). Field labels for the
   * panel body; the section no longer shows an inline summary next to
   * the title.
   */
  audit: {
    /** Empty-state line shown by the Metadata panel when no audit data. */
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
} as const;
