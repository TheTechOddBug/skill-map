/**
 * Provider resolution shared by the tutorial scripts. The `__PROVIDER__`
 * path token resolves to the on-disk base dir, and each provider claims
 * a closed set of node kinds (see `_core.md` §Provider detection).
 */

export const PROVIDER_TOKEN = '__PROVIDER__';

export function providerDir(provider) {
  // agent-skills and Antigravity share the open `.agents/skills/` layout.
  return provider === 'agent-skills' || provider === 'antigravity'
    ? '.agents/skills'
    : '.claude';
}

export const PROVIDER_KINDS = {
  claude: new Set(['agent', 'command', 'skill', 'markdown']),
  'agent-skills': new Set(['skill', 'markdown']),
  antigravity: new Set(['skill', 'markdown']),
};

export function kindsFor(provider) {
  return PROVIDER_KINDS[provider] ?? PROVIDER_KINDS.claude;
}

/**
 * Per-provider kind directories. The token path is always written in
 * the claude shape (`__PROVIDER__/skills/<name>/...`); resolving it is
 * NOT a flat string swap, because agent-skills puts skills directly
 * under `.agents/skills/<name>/` (no intermediate `skills/` segment).
 */
const KIND_DIRS = {
  claude: { agents: '.claude/agents', commands: '.claude/commands', skills: '.claude/skills' },
  'agent-skills': { skills: '.agents/skills' },
  antigravity: { skills: '.agents/skills' },
};

/**
 * Resolve a token-form relative path (`__PROVIDER__/skills/x/SKILL.md`,
 * `notes/todo.md`) to its real on-disk path for the provider. Paths
 * without the token are returned unchanged. Unsupported kinds fall back
 * to a flat join, callers skip them before laying, so the fallback only
 * matters for footprint deletes (a no-op on a path never written).
 */
export function resolveTargetPath(tokenRel, provider) {
  if (!tokenRel.startsWith(`${PROVIDER_TOKEN}/`)) return tokenRel;
  const rest = tokenRel.slice(PROVIDER_TOKEN.length + 1);
  const slash = rest.indexOf('/');
  const kindSeg = slash >= 0 ? rest.slice(0, slash) : rest;
  const tail = slash >= 0 ? rest.slice(slash + 1) : '';
  const base = (KIND_DIRS[provider] ?? KIND_DIRS.claude)[kindSeg];
  if (!base) return `${providerDir(provider)}/${rest}`;
  return tail ? `${base}/${tail}` : base;
}

/**
 * Derive a node kind from a token-form relative path. Matches how
 * skill-map's providers classify by directory: agents / commands /
 * skills folders under the provider dir, everything else markdown.
 */
export function kindForPath(tokenRelPath) {
  if (tokenRelPath.startsWith(`${PROVIDER_TOKEN}/agents/`)) return 'agent';
  if (tokenRelPath.startsWith(`${PROVIDER_TOKEN}/commands/`)) return 'command';
  if (tokenRelPath.startsWith(`${PROVIDER_TOKEN}/skills/`)) return 'skill';
  return 'markdown';
}
