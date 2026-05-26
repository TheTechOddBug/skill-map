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
    tags: 'Tags',
    path: 'Path',
    tokens: 'Tokens',
    stability: 'Stability',
    stale: 'Stale',
    issues: 'Issues',
  },
  /**
   * Header tooltip for the compact Stale column. The body / row level
   * surfaces the per-node detail (which side drifted) via
   * `effectiveStaleTooltip`; this header tooltip explains the column
   * itself to operators scanning the table for the first time.
   */
  staleHeaderTooltip: 'Sidecar drift: clock icon appears on rows whose body or frontmatter changed since the last bump.',
  emptyFiltered: 'No nodes match the current filters.',
  emptyAll: 'No nodes loaded.',
  emptyAllHint: 'Run a scan from the topbar to populate the collection.',
  resetFilters: 'Reset filters',
  rowAriaLabel: (name: string) => `Inspect ${name}`,
  tokensTooltip: (tokens: number): string => `${tokens.toLocaleString()} tokens`,
  /** Overflow suffix in the name cell when more than 3 tags exist. */
  tagsOverflow: (n: number) => `+${n}`,
  /**
   * Placeholder glyph for missing scalar values (name, issues empty
   * cell). Stability does NOT use this, missing stability is conflated
   * with implicit `stable` (see `rowStability` in list-view.ts).
   * Middle dot reads as "no value" in dense tables, the project-wide
   * em-dash ban applies here too even though this is a sentinel.
   */
  missing: '·',
} as const;
