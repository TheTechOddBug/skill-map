---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Provider-aware confidence bump for resolved invocation links. Three changes ship together:

1. **`core/markdown-link` references emit at confidence `1.0`** (previously `0.95`). The `[text](path)` syntax is unambiguous, there is no degree of inference left to discount; whether the path resolves is a separate concern owned by the `core/broken-ref` analyzer.

2. **New `IProviderKind.identifiers`** declaring how to derive a kind's canonical invocation handle(s). Closed set: `'frontmatter.name'`, `'filename-basename'`, `'dirname'`. Multiple sources accumulate (built-in Anthropic skills declare `['frontmatter.name', 'dirname']` so a skill without an explicit `name:` still resolves via the directory between `.claude/skills/` and `/SKILL.md`, matching https://code.claude.com/docs/en/skills.md).

3. **New `IProvider.resolution: Record<linkKind, targetKind[]>`** declaring the strict per-link-kind matrix the post-walk transform consults. `claude` ships `{ mentions: ['agent'], invokes: ['command', 'skill'] }`; `gemini` ships `{ mentions: ['agent'], invokes: ['skill'] }`; `openai` `{ mentions: ['agent'] }`; `agent-skills` `{ invokes: ['skill'] }`. A `/foo` slash matching an agent named `foo` does NOT bump because `invokes` excludes `agent` (the link-conflict / kind-mismatch analyzers handle that case separately).

The kernel renames `liftMentionConfidence` → `liftResolvedLinkConfidence` and generalises the rule to cover `mentions`, `invokes`, and `references` uniformly. Path-match (target equals a node path) still applies universally; name-match goes through the source Provider's resolution map. `broken-ref`'s scope (kind-agnostic "name exists somewhere") stays unchanged.

Spec wording: new `§Provider · kind identifiers` and `§Provider · resolution rules` sections in `spec/architecture.md`.

## User-facing

**Invocation links to resolved targets now render at full confidence.** `@reviewer` mentions and `/explore` slash commands that match an existing agent / skill / command in your project show up at confidence `1.0` (previously `0.5` / `0.8`), so the graph no longer dims them.
