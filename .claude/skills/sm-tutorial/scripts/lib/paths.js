/**
 * Provider resolution shared by the tutorial scripts. The `__PROVIDER__`
 * path token resolves to the on-disk base dir, and each provider claims
 * a closed set of node kinds (see `_core.md` §Provider detection).
 */

export const PROVIDER_TOKEN = '__PROVIDER__';

export function providerDir(provider) {
  // agent-skills, Antigravity, Codex, and OpenCode all keep their SKILLS under
  // the open `.agents/skills/` layout. (Codex additionally has TOML agents
  // under `.codex/agents/`, supplied by the codex overlay's literal paths, not
  // this single base dir. OpenCode is rich-capable but joins the open-standard
  // BASIC track here: the tutorial teaches its shared `.agents/skills/` layer,
  // not its own `.opencode/` agents/commands.)
  return provider === 'agent-skills' || provider === 'antigravity' || provider === 'codex' || provider === 'opencode'
    ? '.agents/skills'
    : '.claude';
}

export const PROVIDER_KINDS = {
  claude: new Set(['agent', 'command', 'skill', 'markdown']),
  // Codex authors its agents as TOML under `.codex/agents/` (a different shape
  // than the base `__PROVIDER__/agents/*.md`), so the base tier lays only its
  // shared skill + markdown nodes; the codex overlay supplies the TOML agents
  // and the command-as-skill nodes (Codex has no `command` kind).
  codex: new Set(['skill', 'markdown']),
  'agent-skills': new Set(['skill', 'markdown']),
  antigravity: new Set(['skill', 'markdown']),
  // OpenCode is rich-capable (it has agent + command kinds in the product), but
  // its tutorial runs on the BASIC track via the shared open standard, so only
  // skill + markdown are taught here (its agents/commands are out of scope).
  opencode: new Set(['skill', 'markdown']),
};

export function kindsFor(provider) {
  return PROVIDER_KINDS[provider] ?? PROVIDER_KINDS.claude;
}

/**
 * Tutorial track for a provider, by the "does this lens have an `agent`
 * kind?" axis (see `_core.md` §Provider detection):
 *   - `rich`  (agent + skill + slash + `@`): `claude`, `codex`.
 *   - `basic` (skill + markdown, connected by markdown references): the
 *     open-standard family `agent-skills`, `antigravity`, `opencode`
 *     (OpenCode is rich-capable but joins basic via the shared open standard).
 * The book renders the track's parts; the same lens always resolves to
 * the same track, so a resumed session never re-derives it.
 */
export function trackFor(provider) {
  return provider === 'claude' || provider === 'codex' ? 'rich' : 'basic';
}

/**
 * The provider whose fixture overlays a given provider reuses. The
 * open-standard family (`agent-skills`, `antigravity`, `opencode`) shares one
 * on-disk shape (`.agents/skills/`, skill + markdown, connected by markdown
 * references), so `antigravity` and `opencode` reuse the canonical
 * `agent-skills` overlays rather than duplicating them. Every other provider
 * keys its own.
 */
export function overlayKey(provider) {
  return provider === 'antigravity' || provider === 'opencode' ? 'agent-skills' : provider;
}

/**
 * Kinds whose edit fragments (the todo-connectors hub bullets, etc.) apply for
 * a provider, keyed by TRACK, not by the base-tier kinds. A rich provider links
 * to every node role even when it renders some differently (Codex's agent is a
 * TOML overlay and its command-node is a skill), so every hub bullet applies;
 * the per-provider overlay then supplies the right connector grammar (claude
 * `/`+`@`, codex `$`-invoke + `@`-file / markdown-link references). A basic
 * provider only has skill + markdown, so the agent / command bullets fold away.
 */
export function fragmentKindsFor(provider) {
  return trackFor(provider) === 'rich'
    ? new Set(['agent', 'command', 'skill', 'markdown'])
    : new Set(['skill', 'markdown']);
}

/**
 * Per-provider kind directories. The token path is always written in
 * the claude shape (`__PROVIDER__/skills/<name>/...`); resolving it is
 * NOT a flat string swap, because agent-skills puts skills directly
 * under `.agents/skills/<name>/` (no intermediate `skills/` segment).
 */
const KIND_DIRS = {
  claude: { agents: '.claude/agents', commands: '.claude/commands', skills: '.claude/skills' },
  codex: { skills: '.agents/skills' },
  'agent-skills': { skills: '.agents/skills' },
  antigravity: { skills: '.agents/skills' },
  opencode: { skills: '.agents/skills' },
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

/**
 * Logical, lens-agnostic node id for a token-form path. The SAME
 * conceptual node renders in a different kind per lens (a `content-editor`
 * is an `agent` on claude but a `skill` on agent-skills), so a `--only`
 * filter or an edit target written in the claude shape must still match
 * the agent-skills overlay. Agents / commands use the file stem; skills
 * use the skill directory name; everything else (markdown, notes, docs)
 * keeps its relpath verbatim. So both `__PROVIDER__/agents/content-editor.md`
 * and `__PROVIDER__/skills/content-editor/SKILL.md` resolve to `content-editor`.
 */
export function nodeIdForTokenPath(tokenRelPath) {
  const flat = tokenRelPath.match(/^__PROVIDER__\/(?:agents|commands)\/(.+)\.md$/);
  if (flat) return flat[1];
  const skill = tokenRelPath.match(/^__PROVIDER__\/skills\/([^/]+)\//);
  if (skill) return skill[1];
  // Codex renders an agent as a literal `.codex/agents/<name>.toml`; map it
  // to the same id as the claude-shaped `__PROVIDER__/agents/<name>.md` so a
  // `--only` filter (or the skipped-node dedup) matches across the two shapes.
  const codexAgent = tokenRelPath.match(/^\.codex\/agents\/(.+)\.toml$/);
  if (codexAgent) return codexAgent[1];
  return tokenRelPath;
}
