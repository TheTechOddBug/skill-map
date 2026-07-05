/**
 * Strings rendered by `<sm-node-card>` (graph node body). Labels
 * are short codes, tooltips spell them out so the abbreviation
 * doesn't need to be memorised.
 */
export const NODE_CARD_TEXTS = {
  llm: {
    /** Agent-only: `summary.whenToUse` */
    when: { label: 'when', tooltip: 'When to use (LLM-inferred)' },
    /** Agent-only: `summary.interactionStyle` */
    style: { label: 'style', tooltip: 'Interaction style (LLM-inferred)' },
    /** Agent-only: `summary.capabilities[]` */
    does: { label: 'does', tooltip: 'Capabilities (LLM-inferred)' },
    /** Skill-only: `summary.recipe[]` */
    steps: { label: 'steps', tooltip: 'Recipe / ordered steps (LLM-inferred)' },
    /** Skill-only: `summary.preconditions[]` */
    pre: { label: 'pre', tooltip: 'Preconditions (LLM-inferred)' },
    /** Skill-only: `summary.outputs[]` (LLM-inferred, distinct from frontmatter outputs) */
    out: { label: 'out', tooltip: 'Outputs / produced artifacts (LLM-inferred)' },
    /** Skill / command: `summary.sideEffects[]` */
    fx: { label: 'fx', tooltip: 'Side effects (LLM-inferred)' },
    /** Command-only: `summary.invocationExample` */
    eg: { label: 'eg', tooltip: 'Invocation example (LLM-inferred)' },
    /** Markdown-only: `summary.topics[]` */
    topics: { label: 'topics', tooltip: 'Topics covered (LLM-inferred)' },
    /** Markdown-only: `summary.keyFacts[]` */
    facts: { label: 'facts', tooltip: 'Key facts (LLM-inferred discrete claims)' },
  },
  meta: {
    model: 'model',
    allowed: 'allowed',
    tags: 'tags',
  },
  stats: {
    /** Pluralised in formatters, singular is template fallback only. */
    errors: (n: number) => `${n} error${n === 1 ? '' : 's'}`,
    warns: (n: number) => `${n} warning${n === 1 ? '' : 's'}`,
    bytes: (total: number) => `${total.toLocaleString('en-US')} bytes`,
    tokens: (total: number) => `${total.toLocaleString('en-US')} tokens`,
  },
  stability: {
    experimental: 'experimental',
    deprecated: 'deprecated',
  },
  /**
   * Live execution counter (spec/provider-activity.md §Execution
   * stats). The pill shows a compact count; the tooltip carries the
   * long form (count, last start, distinct executing contexts). All
   * values are server-accumulated and session-scoped (reset when
   * `sm serve` restarts).
   */
  activity: {
    tooltip: (stats: { count: number; lastStartAt: number; distinctOwners: number }): string => {
      const times = stats.count === 1 ? 'once' : `${stats.count.toLocaleString('en-US')} times`;
      const last = new Date(stats.lastStartAt).toLocaleTimeString();
      const contexts = stats.distinctOwners === 1 ? '1 context' : `${stats.distinctOwners} contexts`;
      return `Executed ${times} this session\nLast start: ${last}\n${contexts}`;
    },
    a11y: (count: number): string =>
      `Executed ${count} time${count === 1 ? '' : 's'} this session`,
  },
  /**
   * Step 9.6.5, sidecar drift badge tooltips. The badge surfaces only
   * for nodes whose sidecar overlay reports a stale status; tooltip
   * spells out which side drifted (body, frontmatter, or both).
   */
  sidecar: {
    staleBody: 'Stale: body content changed since the last bump.',
    staleFrontmatter: 'Stale: frontmatter changed since the last bump.',
    staleBoth: 'Stale: body and frontmatter changed since the last bump.',
  },
  /** Overflow chip on the tag row when more than 3 tags exist. */
  tagOverflow: (n: number) => `+${n} more`,
  /** Aria-label for a clickable tag chip on the card (filters the map by that tag). */
  tagFilterAriaLabel: (tag: string) => `Select every node tagged ${tag} on the map`,
  ariaExpand: 'Expand',
  ariaFavoriteAdd: 'Add to favorites',
  ariaFavoriteRemove: 'Remove from favorites',
  favoriteAddTooltip: 'Mark as favorite',
  favoriteRemoveTooltip: 'Unfavorite',
} as const;
