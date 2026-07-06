---
"@skill-map/cli": minor
---

Frontmatter diagnostics close three silent-loss gaps: a blank line before the opening `---` fence now warns via `frontmatter-malformed`, a declared-but-empty block now runs per-kind validation, and an unquoted `:` in a value gets an actionable quoting hint; a parse error no longer also reports present-but-unparseable fields as missing.

## User-facing

Frontmatter mistakes now get clearer feedback: a blank line before the opening ---, an empty frontmatter block, or an unquoted colon in a value are flagged with hints that say how to fix them, instead of losing your metadata silently.
