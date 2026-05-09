/** UI strings for the FilterBar component. */
export const FILTER_BAR_TEXTS = {
  searchPlaceholder: 'Search path, name, description…',
  allKindsPlaceholder: 'All kinds',
  allStabilitiesPlaceholder: 'All stabilities',
  hasIssues: 'Has issues',
  staleOnly: 'Stale only',
  favoritesOnly: 'Favorites only',
  reset: 'Reset',
  /**
   * Active tag-filter chip label. Renders as `Tag: <tag> (author)`,
   * `Tag: <tag> (you)`, or `Tag: <tag>` for the union mode (`'any'`).
   * The chip itself is removable; clicking the `×` clears the filter
   * via `clearTagFilter()`.
   */
  tagFilterLabel: ({ tag, source }: { tag: string; source: 'author' | 'user' | 'any' }): string => {
    if (source === 'author') return `Tag: ${tag} (author)`;
    if (source === 'user') return `Tag: ${tag} (you)`;
    return `Tag: ${tag}`;
  },
} as const;
