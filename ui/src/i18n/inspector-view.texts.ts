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
    tagFilterAriaLabel: (tag: string) => `Select every node tagged ${tag} on the map`,
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
    metadata: 'Metadata',
    plugins: 'Plugin contributions',
    body: 'Body',
  },
  body: {
    // The body section is hidden entirely when there is nothing to
    // render (empty / unavailable / error states), so only the
    // transient loading line survives in the catalog.
    loading: 'Loading body…',
  },
  /** Findings list, fix hint label rendered before the per-issue summary. */
  findingHintLabel: 'Hint:',
  /** Aria label for the action-error banner dismiss button. */
  actionErrorDismissAriaLabel: 'Dismiss',
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
} as const;
