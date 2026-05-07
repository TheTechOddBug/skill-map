/**
 * UI strings for `<sm-vendor-frontmatter>` — the tiered vendor
 * frontmatter renderer the inspector embeds for each provider+kind.
 * Catalog curation 2026-05-07: agent T1–T4 tiering locked
 * block-by-block. Other kinds reuse the same i18n surface but expose
 * fewer tiers.
 */
export const VENDOR_FRONTMATTER_TEXTS = {
  /** Header for the whole vendor block. */
  header: 'Vendor frontmatter',
  /** Tier headings (collapsed-by-default sections T3 / T4). */
  tiers: {
    behavior: 'Behavior',
    integrations: 'Integrations',
    behaviorCount: (n: number) => `${n} field${n === 1 ? '' : 's'}`,
    integrationsCount: (n: number) => `${n} entr${n === 1 ? 'y' : 'ies'}`,
  },
  /** Per-field labels — verbatim Anthropic naming where the schema is camelCase. */
  fields: {
    name: 'Name',
    description: 'Description',
    tools: 'Tools',
    model: 'Model',
    skills: 'Skills',
    disallowedTools: 'Disallowed tools',
    initialPrompt: 'Initial prompt',
    permissionMode: 'Permission mode',
    maxTurns: 'Max turns',
    memory: 'Memory',
    background: 'Background',
    effort: 'Effort',
    isolation: 'Isolation',
    mcpServers: 'MCP servers',
    hooks: 'Hooks',
    color: 'Color',
  },
  /** Empty-section label when a kind declares zero vendor-specific fields. */
  emptyKind: 'No vendor-specific frontmatter for this kind.',
  /**
   * Tooltip on the `initialPrompt` toggle when the prompt is collapsed.
   * Click to expand the full quote-block.
   */
  initialPromptHint: 'Click to expand the auto-submitted first turn.',
  /** Aria-label for the expand chevron on `initialPrompt`. */
  initialPromptToggle: 'Toggle initial prompt',
} as const;
