/**
 * UI strings for `<sm-annotations-panel>` (Step 9.6 catalog curation,
 * 2026-05-07). The panel renders the curated 15-field annotation
 * catalog the orchestrator + user locked block-by-block. Sub-section
 * order matches the inspector tiering decision: Lifecycle →
 * Supersession → Provenance → Taxonomy → Docs. The pre-curation
 * `Display` section was dropped end-to-end (the only surviving display
 * field is `hidden`, which lives under Taxonomy now).
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
    released: 'Released',
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
    hidden: 'Hidden',
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
