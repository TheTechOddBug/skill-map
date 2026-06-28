---
name: OpenCode demo project
description: A wired OpenCode corpus for the fix:opencode dev scope.
---

# OpenCode demo project

A small example project wired for the OpenCode CLI. `pnpm fix:opencode` brings
skill-map up against it so you can see the **opencode lens** classify its own
agents (`.opencode/agent/*.md`) and commands (`.opencode/commands/*.md`), plus
skills from the three homes OpenCode reads, then draw the links extracted from
each body (slash invocations like `/test` and `/deploy`, and markdown
references to the docs and skills).

It deliberately exercises the full surface:

- **Agents** (`.opencode/agent/`, handle = filename, frontmatter `description` +
  `mode` + `model` + `permission`): `builder` (primary), `reviewer` and
  `deployer` (subagents). Each invokes a command and links the doc / skill it
  leans on.
- **Commands** (`.opencode/commands/`, invoked `/<name>`): `test`, `lint`,
  `deploy`. The agents' `/test`, `/lint`, `/deploy` tokens resolve to these
  (the opencode provider maps `invokes: ['command']`).
- **Skills, three homes, all classified `opencode/skill`**: own
  (`.opencode/skills/run-migrations`, `format-code`), Claude-compatible
  (`.claude/skills/security-audit`, OpenCode reads it), and open standard
  (`.agents/skills/changelog-entry`). Skills load via OpenCode's native `skill`
  tool, so they have no slash edge; they connect through markdown links.
- **The asymmetric Claude-compat**: `.claude/agents/legacy-bot.md` and
  `.claude/commands/status.md` fall through to `core/markdown` under the
  opencode lens. OpenCode reads Claude *skills*, not Claude *agents* /
  *commands*, so those are NOT classified as opencode nodes. Switch the lens to
  `claude` (`sm config set activeProvider claude`) and watch them flip to
  `claude/agent` + `claude/command` while the `.opencode/*` files drop to
  markdown: proof the two lenses never collide.
- **Rules**: `AGENTS.md` falls through to `core/markdown`, yet its `/test` and
  `/deploy` tokens still resolve (the slash grammar runs across the project).

The lens is pinned via `activeProvider` in `.skill-map/settings.json` because
the fixture carries `.opencode/`, `.claude/`, and `.agents/` markers at once;
a real OpenCode project carrying only `.opencode/` auto-detects the lens.
