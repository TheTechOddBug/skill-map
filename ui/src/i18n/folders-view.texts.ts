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
  /** Per-leaf inline button that jumps to the graph view focused on the node. */
  openInGraphTooltip: 'Open in graph',
  openInGraphAriaLabel: (name: string) => `Open ${name} in graph view`,
  /**
   * Column headers. The structural (tree) column is unique to the
   * folders view; the rest mirror the prior list view shape so the
   * data table reads familiar.
   */
  columns: {
    tree: 'Folder / Node',
    kind: 'Kind',
    /** Incoming references (count of edges that target this node). */
    linksIn: 'in',
    /** Outgoing references (count of edges this node emits). */
    linksOut: 'out',
    tokens: 'Tokens',
    stability: 'Stability',
    issues: 'Issues',
  },
  linksInHeaderTooltip: 'Incoming references: how many other nodes link to this one.',
  linksOutHeaderTooltip: 'Outgoing references: how many nodes this one links to.',
  /** Tooltip on the Tokens cell, full integer with thousands separator. */
  tokensTooltip: (tokens: number): string => `${tokens.toLocaleString()} tokens`,
  /**
   * Counts shown next to a folder. `nodes` is the total leaf count in
   * the subtree (recursive). `errors` / `warns` are summed across all
   * leaves of the subtree; rendered only when > 0.
   */
  folderCount: (nodes: number) => `${nodes}`,
  /**
   * Placeholder glyph for missing scalar values. Middle dot reads as
   * "no value" in dense rows; the project-wide em-dash ban applies
   * here too even though this is a sentinel.
   */
  missing: '·',
} as const;
