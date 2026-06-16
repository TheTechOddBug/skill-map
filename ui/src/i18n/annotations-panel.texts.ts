/**
 * UI strings for `<sm-annotations-panel>`. The panel renders the
 * curated annotation catalog the orchestrator + user locked
 * block-by-block. Sub-section order matches the inspector tiering
 * decision: Authors → Repository → Docs. Tags moved to the inspector
 * header (clickable tag row).
 */
export const ANNOTATIONS_PANEL_TEXTS = {
  cardHeader: 'Annotations',
  emptyOverlay: 'No sidecar (.sm) file present for this node.',
  emptyAnnotations: 'Sidecar present but no annotations are declared yet.',
  sections: {
    provenance: 'Authors',
    repository: 'Repository',
    docs: 'Docs',
  },
  fields: {
    authors: 'Authors',
    license: 'License',
    source: 'Source',
    sourceVersion: 'Source version',
    docsUrl: 'Docs URL',
  },
} as const;
