---
name: Antigravity demo project
description: A wired Google Antigravity corpus for the fix:antigravity dev scope.
---

# Antigravity demo project

A small example project wired for Google Antigravity. `pnpm fix:antigravity`
brings skill-map up against it so you can see the antigravity lens classify
the `.agent/workflows/*.md` workflows (its own kind) and the
`.agents/skills/*/SKILL.md` skills (the open standard it adopted), then
draw the links extracted from each body: slash invocations across kinds
(`/run-tests`, `/deploy`, `/go-live`) and references to the docs.

It deliberately exercises the full surface:

- **Workflows** (handle = filename, frontmatter is `description` only):
  `deploy` (`// turbo-all`), `release` and `scaffold-component`
  (per-step `// turbo`), `go-live`, and `minimal`. Only `// turbo` and
  `// turbo-all` are used, the two annotations the shipped Antigravity
  runtime documents.
- **Skills**: `run-tests` and `changelog-entry`, invoked across workflows.
- **Reserved-name collisions**: the `goal` skill and the `tasks` workflow
  are named after built-in `agy` slash commands, so `core/name-reserved`
  flags both (the catalog covers skills and workflows alike).
- **Rules**: `AGENTS.md` falls through to the universal `core/markdown`
  fallback, yet its `/deploy` and `/go-live` tokens still resolve.

Note: the antigravity provider ships `beta` (enabled by default), so this
scope only pins the lens via `activeProvider` in `.skill-map/settings.json`.
A `.agent/workflows/` project also auto-detects the antigravity lens (and,
when it also carries `.agents/`, prompts to choose between antigravity and
the open `agent-skills` default).
