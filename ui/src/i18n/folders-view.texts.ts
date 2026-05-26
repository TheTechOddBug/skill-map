/** UI strings for the FoldersView. */
export const FOLDERS_VIEW_TEXTS = {
  title: 'Folders',
  subtitleDefault: 'Filesystem view of the collection, click a folder to expand or a node to inspect it on the graph.',
  showingPrefix: 'Showing',
  showingSuffix: (total: number) => ` of ${total} nodes.`,
  loading: 'Loading collection…',
  emptyFiltered: 'No nodes match the current filters.',
  emptyAll: 'No nodes loaded.',
  emptyAllHint: 'Run a scan from the topbar to populate the collection.',
  resetFilters: 'Reset filters',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  folderAriaLabel: (name: string, expanded: boolean) =>
    `${expanded ? 'Collapse' : 'Expand'} folder ${name}`,
  leafAriaLabel: (name: string) => `Inspect ${name}`,
  /**
   * Counts shown next to a folder. `nodes` is the total leaf count in
   * the subtree (recursive). `errors` / `warns` are summed across all
   * leaves of the subtree; rendered only when > 0.
   */
  folderCount: (nodes: number) => `${nodes}`,
  /**
   * Placeholder glyph for missing scalar values. Same convention as
   * list-view, middle dot reads as "no value" in dense rows.
   */
  missing: '·',
} as const;
