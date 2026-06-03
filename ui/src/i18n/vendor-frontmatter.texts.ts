/**
 * UI strings for `<sm-vendor-frontmatter>`. The component renders a
 * single `Definition` section inside the inspector body, one rail, one
 * title, that lists every vendor frontmatter field in order:
 *
 *   - Runtime fields (model, effort, permission, max turns, memory,
 *     background, isolation) and capability fields (tools, disallowed
 *     tools, skills, MCP servers, hooks) flow together in one
 *     definition list.
 *   - `Initial prompt`: the opening callout, rendered as a quote block
 *     under a small sub-label at the foot of the same section.
 *
 * The grouping is a skill-map presentation choice, not vendor JSON
 * structure (the frontmatter is flat). The section hides on its own when
 * every field is empty.
 */
export const VENDOR_FRONTMATTER_TEXTS = {
  sections: {
    definition: 'Definition',
    initialPrompt: 'Initial prompt',
  },
  /** Per-field labels, verbatim Anthropic naming where the schema is camelCase. */
  fields: {
    tools: 'Tools',
    model: 'Model',
    skills: 'Skills',
    disallowedTools: 'Disallowed',
    permissionMode: 'Permission',
    maxTurns: 'Max turns',
    memory: 'Memory',
    background: 'Background',
    effort: 'Effort',
    isolation: 'Isolation',
    mcpServers: 'MCP servers',
    hooks: 'Hooks',
  },
  /** Skill / command base fields. */
  skillBaseFields: {
    whenToUse: 'When to use',
    argumentHint: 'Argument hint',
    arguments: 'Arguments',
    allowedTools: 'Allowed tools',
    disallowedTools: 'Disallowed tools',
    model: 'Model',
    effort: 'Effort',
    context: 'Context',
    agent: 'Agent',
    shell: 'Shell',
    paths: 'Paths',
    disableModelInvocation: 'Model invocation',
    userInvocable: 'User invocable',
  },
} as const;
