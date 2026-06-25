---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

New built-in `core/backtick-balance` analyzer emits a `warn` when a node body has an unclosed backtick: an opening fenced block (``` / ~~~) that is never closed, or an inline span whose backtick run has no equal-length closer (CommonMark rule, escaped backticks treated as literal). It reports the file-relative line. This catches the body-syntax defect that corrupts the code-strip policy, where a dangling fence swallows the rest of the file and prose extractors stop emitting edges.

## User-facing
Scans now warn when a Markdown file has an unclosed backtick: a code fence (```) that is never closed, or an inline `code` span missing its closing backtick. The warning points at the exact line so you can fix the file before it breaks how the rest of its links are read.
