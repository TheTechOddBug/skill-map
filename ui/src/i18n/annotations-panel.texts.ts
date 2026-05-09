/**
 * UI strings for `<sm-annotations-panel>`. The panel renders the
 * curated 13-field annotation catalog the orchestrator + user locked
 * block-by-block. Sub-section order matches the inspector tiering
 * decision: Lifecycle → Supersession → Provenance → Taxonomy → Docs.
 */
export const ANNOTATIONS_PANEL_TEXTS = {
  cardHeader: 'Annotations',
  emptyOverlay: 'No sidecar (.sm) file present for this node.',
  emptyAnnotations: 'Sidecar present but no annotations are declared yet.',
  sections: {
    lifecycle: 'Lifecycle',
    supersession: 'Supersession',
    provenance: 'Provenance',
    taxonomy: 'Taxonomy',
    docs: 'Docs',
  },
  fields: {
    version: 'Version',
    stability: 'Stability',
    supersedes: 'Supersedes',
    supersededBy: 'Superseded by',
    requires: 'Requires',
    conflictsWith: 'Conflicts with',
    related: 'Related',
    authors: 'Authors',
    license: 'License',
    source: 'Source',
    sourceVersion: 'Source version',
    tags: 'Tags',
    docsUrl: 'Docs URL',
  },
  /**
   * Tooltip on a path-typed chip whose target is not in the local node
   * store (out-of-scope or genuinely missing). Renders as a muted /
   * strikethrough chip; the host (inspector) decides whether to upgrade
   * the heuristic to a verified-dead state via the BFF.
   */
  brokenRefTooltip: 'This path does not resolve to a node in the current scan scope.',
} as const;
