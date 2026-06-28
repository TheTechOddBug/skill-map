---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The kernel now flags an unclosed backtick in a node body during the scan walk: an opening fenced block (``` or ~~~) that is never closed, or an inline span whose backtick run has no equal-length closer. The verdict is derived from the same code-strip scanner the prose extractors rely on, so it pinpoints the body-syntax defect where a dangling fence swallows the rest of the file and prose extractors stop emitting edges. The warning is persisted and reused across incremental scans.

## User-facing
Scans now warn when a Markdown file has an unclosed backtick (a code fence ``` never closed, or an inline `code` span missing its closer). The warning carries the offending line so you can fix it before it breaks how the file's links are read.
