---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Retire the `gemini` Provider and onboard the `antigravity` Provider. Google released the Antigravity CLI on 2026-05-19 as the replacement for the Gemini CLI (which sunsets 2026-06-18 for consumer tiers). Antigravity preserved the four pillars of Gemini CLI (Agent Skills, Hooks, Subagents, Extensions/plugins) but adopted the open-standard `.agents/` layout instead of carrying forward a vendor-specific `.gemini/` directory, so the old Provider classified obsolete paths.

Three coordinated changes ship together:

1. **`gemini` bundle deleted in full.** The provider, schemas, conformance fixtures, and tests under `src/plugins/gemini/` are gone. Any project relying on `.gemini/` classification routes Antigravity skills through the existing `agent-skills` Provider (open standard, dirname-based identifier) and AGENTS.md through the universal `core/markdown` fallback.

2. **New `antigravity` bundle (metadata-only).** `src/plugins/antigravity/providers/antigravity/` ships an empty-kinds Provider whose `classify()` always returns `null`. It contributes lens identity and a seed `reservedNames` catalog (Antigravity TUI built-in slash commands: `/agents`, `/help`, `/quit`, `/exit`, `/skills`, `/hooks`). When Google formalises subagent / hook on-disk paths the Provider will gain `kinds` and `classify()` accordingly.

3. **Active-lens auto-detect drops the `.gemini/` marker.** No replacement marker (Antigravity has no vendor-specific workspace directory). The lens is set manually via `sm config set activeProvider antigravity`.

Spec edits: `spec/architecture.md`, `spec/cli-contract.md`, `spec/plugin-author-guide.md`, `spec/db-schema.md`, `spec/README.md`, schemas in `spec/schemas/` updated to remove `gemini` references and add Antigravity context. `spec/index.json` regenerated.

## User-facing

**Gemini CLI support retired.** Antigravity CLI projects (Google's May 2026 replacement) scan via the open-standard `.agents/skills/` paths under the existing `agent-skills` lens. Run `sm config set activeProvider antigravity` to flag a project as Antigravity-flavoured.
