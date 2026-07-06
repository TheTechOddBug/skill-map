---
"@skill-map/cli": minor
---

Frontmatter diagnostics now detect a metadata block closed early by a stray `---` line inside it: a new `frontmatter-malformed` hint `early-close` names the leaked fields (gated on at least one being a schema-declared property) and suppresses the misleading missing-required report for fields sitting below the stray close; the combined BOM + blank-line accident before the fence now classifies as `byte-order-mark` instead of falling through every heuristic.

## User-facing

A stray `---` line inside your frontmatter is now flagged with the fields that were silently falling out of the block, and a byte-order mark plus a blank line before the frontmatter is called out too, instead of the metadata quietly disappearing.
