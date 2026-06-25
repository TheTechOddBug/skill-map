---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Make `name`/`description` per-kind requirements instead of universal ones: the frontmatter base only defines the two fields, and `required` moves to the kinds whose vendor mandates them (Claude agent, Codex agent, Agent Skills skill), leaving the `markdown` fallback and Claude skill/command optional. Per-kind schemas are re-certified against current vendor docs, and the redundant base check in `core/schema-violation` is dropped so each per-kind schema is the single source of truth.

## User-facing

**Frontmatter checks now follow each vendor's rules.** Plain Markdown files and Claude skills/commands without a `name` or `description` are no longer flagged, and Codex/Claude model fields accept current values like `xhigh` reasoning effort and the `fable` model alias.
