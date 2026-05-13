/**
 * UI strings for `<sm-vendor-frontmatter>`, collapsed-by-default
 * "Provider-specific" section the inspector embeds for each
 * provider+kind. Catalog curation refinement (2026-05-07) consolidated
 * the previous T1–T4 tiering into a single section so the inspector
 * surface stays scannable.
 */
export const VENDOR_FRONTMATTER_TEXTS = {
  /** Header for the collapsed-by-default Provider-specific section. */
  providerSpecificHeader: 'Provider-specific',
  /** Pluralised count suffix (`(8 fields)` / `(1 field)`). */
  fieldCount: (n: number) => `${n} field${n === 1 ? '' : 's'}`,
  /** Per-field labels, verbatim Anthropic naming where the schema is camelCase. */
  fields: {
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
  },
  /** Aria-label for the expand chevron on `initialPrompt`. */
  initialPromptToggle: 'Toggle initial prompt',
} as const;
