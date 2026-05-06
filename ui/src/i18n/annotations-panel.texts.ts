/**
 * UI strings for `<sm-annotations-panel>` (Step 9.6.5). Section labels
 * mirror the logical groupings declared in `spec/schemas/annotations.schema.json`.
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
    display: 'Display',
    docs: 'Docs',
  },
  fields: {
    version: 'Version',
    stability: 'Stability',
    created: 'Created',
    updated: 'Updated',
    released: 'Released',
    supersedes: 'Supersedes',
    supersededBy: 'Superseded by',
    requires: 'Requires',
    conflictsWith: 'Conflicts with',
    provides: 'Provides',
    related: 'Related',
    type: 'Type',
    author: 'Author',
    authors: 'Authors',
    license: 'License',
    source: 'Source',
    sourceVersion: 'Source version',
    tags: 'Tags',
    category: 'Category',
    keywords: 'Keywords',
    icon: 'Icon',
    color: 'Color',
    priority: 'Priority',
    hidden: 'Hidden',
    docsUrl: 'Docs URL',
  },
} as const;
