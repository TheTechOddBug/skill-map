/**
 * UI strings for `<sm-vendor-frontmatter>`. The component renders three
 * tipographically-separated sub-sections inside the inspector body:
 *
 *   - `Behavior`: how the agent runs (model, effort, permission, max
 *     turns, memory, background, isolation).
 *   - `Capabilities`: what the agent / skill / command can do (tools,
 *     disallowed tools, skills, MCP servers, hooks).
 *   - `Initial prompt`: the opening callout, rendered as a quote block.
 *
 * The wrapper is no longer collapsed; each section hides on its own when
 * the underlying fields are empty.
 */
export const VENDOR_FRONTMATTER_TEXTS = {
  sections: {
    behavior: 'Behavior',
    capabilities: 'Capabilities',
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
