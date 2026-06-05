/** UI strings for the FilesView. */
export const FILES_VIEW_TEXTS = {
  loading: 'Loading collection…',
  emptyFiltered: 'No nodes match the current filters.',
  emptyAll: 'No nodes loaded.',
  emptyAllHint: 'Run a scan from the topbar to populate the collection.',
  resetFilters: 'Reset filters',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  /** Map depth presets (tree header). Curate the map to a folder-depth slice. */
  depthLevel0: 'Map: show only the root level',
  depthLevel1: 'Map: show up to one folder deep',
  depthLevel2: 'Map: show up to two folders deep',
  folderAriaLabel: (name: string, expanded: boolean) =>
    `${expanded ? 'Collapse' : 'Expand'} folder ${name}`,
  leafAriaLabel: (name: string) => `Inspect ${name}`,
  /** Map visibility curation (checkboxes + isolate). */
  mapVisibilityTooltip: 'Toggle visibility on the map',
  mapVisibilityAriaLabel: (name: string) => `Toggle ${name} visibility on the map`,
  isolateTooltip: 'Isolate this node and its direct links on the map',
  isolateAriaLabel: (name: string) => `Isolate ${name} and its direct links on the map`,
  /**
   * Column headers. The structural (tree) column is unique to the
   * files view; the rest mirror the prior list view shape so the
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
    issues: 'Issues',
  },
  linksInHeaderTooltip: 'Incoming references: how many other nodes link to this one.',
  linksOutHeaderTooltip: 'Outgoing references: how many nodes this one links to.',
  /** Aria-label for a sortable data-column header. */
  sortAriaLabel: (column: string) => `Sort by ${column}`,
  /** Aria-label for the structural header that restores the folder tree. */
  sortTreeAriaLabel: 'Show folder tree',
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
