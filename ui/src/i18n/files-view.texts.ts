/** UI strings for the FilesView. */
export const FILES_VIEW_TEXTS = {
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
  /** Map visibility curation (checkboxes + isolate). */
  mapVisibilityTooltip: 'Toggle visibility on the map',
  mapCoveredTooltip: 'On the map via a selected parent folder. Uncheck the parent to change it.',
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
    /** Session-scoped agent-execution count (most/least invoked nodes). */
    activity: 'Activity',
    issues: 'Issues',
    tokens: 'Tokens',
    /** Incoming references (count of edges that target this node). */
    linksIn: 'in',
    /** Outgoing references (count of edges this node emits). */
    linksOut: 'out',
    /** File modification date (sortable, ISO short date in the cell). */
    modified: 'Modified',
  },
  activityHeaderTooltip:
    'Agent executions this session: how many times agents ran this node. Resets when the server restarts.',
  linksInHeaderTooltip: 'Incoming references: how many other nodes link to this one.',
  linksOutHeaderTooltip: 'Outgoing references: how many nodes this one links to.',
  modifiedHeaderTooltip: 'Last modified on disk (file mtime). Hover a cell for the exact time.',
  /** Aria-label for a sortable data-column header. */
  sortAriaLabel: (column: string) => `Sort by ${column}`,
  /** Aria-label for the structural header that restores the folder tree. */
  sortTreeAriaLabel: 'Show folder tree',
  /** Tooltip on the Tokens cell, full integer with thousands separator. */
  tokensTooltip: (tokens: number): string => `${tokens.toLocaleString()} tokens`,
  /** Tooltip on the Activity cell, full integer with thousands separator. */
  activityTooltip: (count: number): string =>
    `${count.toLocaleString()} ${count === 1 ? 'execution' : 'executions'} this session`,
  /**
   * Counts shown next to a folder. `nodes` is the total leaf count in
   * the subtree (recursive). `errors` / `warns` are summed across all
   * leaves of the subtree; rendered only when > 0.
   */
  folderCount: (nodes: number) => `${nodes}`,
  /** Tooltip / aria for the per-folder rolled-up error badge. */
  folderErrorTooltip: (count: number) =>
    `${count} ${count === 1 ? 'error' : 'errors'} across this folder`,
  /** Tooltip / aria for the per-folder rolled-up warning badge. */
  folderWarnTooltip: (count: number) =>
    `${count} ${count === 1 ? 'warning' : 'warnings'} across this folder`,
  /**
   * Placeholder glyph for missing scalar values. Middle dot reads as
   * "no value" in dense rows; the project-wide em-dash ban applies
   * here too even though this is a sentinel.
   */
  missing: '·',
  /**
   * Label for the scrollable listing itself. The table is virtualised, so
   * only a window of rows is in the DOM and Tab cannot walk them; arrow
   * keys move a roving focus instead, which the label announces.
   */
  listAriaLabel: 'Files and folders. Use the arrow keys to move between rows.',
} as const;
