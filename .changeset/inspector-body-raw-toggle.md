---
"@skill-map/cli": minor
---

The inspector's Body section gains a Raw / Rendered toggle: a button at the top of the expanded section flips between the rendered Markdown and a read-only source view, line-numbered and syntax-highlighted like a code editor (the markdown body, or a Codex agent's `developer_instructions`). The preference is sticky across nodes within the session. No extra fetch, the raw view reuses the content already loaded for rendering.

## User-facing

The inspector's Body section now has a Raw / Rendered toggle: flip between the formatted Markdown and a read-only, syntax-highlighted source view (with line numbers) of a node's body, without leaving the panel.
