---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The lens selector now offers a single open lens, `agent-skills` ("Agent Skills"), promoted to stable and locked and made the universal default for projects with no vendor marker (replacing the old `markdown` default). The non-gated `core/markdown` becomes the invisible base: it still classifies every orphan `.md` but is no longer a selectable lens. A new `isLens` flag drives the dropdown, and `PATCH /api/active-provider` rejects non-lens ids.

## User-facing

The provider lens picker is simpler: one open "Agent Skills" lens (the default when no vendor like Claude or Codex is detected) replaces the old separate "Markdown" and "Open Skills" entries. Plain `.md` files are still mapped, same as before.
