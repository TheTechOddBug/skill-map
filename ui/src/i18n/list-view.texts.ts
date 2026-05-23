/** UI strings for the ListView. */
export const LIST_VIEW_TEXTS = {
  title: 'Nodes',
  subtitleDefault: 'Flat view of the collection · click a row to inspect it on the graph.',
  showingPrefix: 'Showing',
  showingSuffix: (total: number) => ` of ${total} nodes.`,
  loading: 'Loading collection…',
  columns: {
    kind: 'Kind',
    name: 'Name',
    path: 'Path',
    version: 'Version',
    stability: 'Stability',
  },
  emptyFiltered: 'No nodes match the current filters.',
  emptyAll: 'No nodes loaded.',
  resetFilters: 'Reset filters',
  rowAriaLabel: (name: string) => `Inspect ${name}`,
  /**
   * Placeholder glyph for missing scalar values (version, stability).
   * Middle dot reads as "no value" in dense tables, the project-wide
   * em-dash ban applies here too even though this is a sentinel.
   */
  missing: '·',
} as const;
