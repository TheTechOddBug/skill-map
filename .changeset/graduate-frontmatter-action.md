---
"@skill-map/cli": minor
---

The `core/ai-frontmatter-action` standalone action graduated from experimental to stable and now ships enabled by default, after its live playground pass produced the correct frontmatter block first try (name aligned to the file handle, description in the body's language); doctor's default disabled count drops to 4.

## User-facing

**The AI action that fills in missing frontmatter now comes enabled out of the box.** It writes a name matching the filename and a description saying when to use the file, and its button only appears on files actually missing one of those fields.
