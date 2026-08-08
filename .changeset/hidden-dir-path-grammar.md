---
'@skill-map/spec': patch
'@skill-map/cli': patch
---

Both path grammars accept a hidden first segment now: a backticked `.claude/minions.md` and an `@.claude/minions.md` token emit their links instead of silently matching nowhere (the word-character anchor rejected the leading dot, so paths under `.claude/`, `.codex/` or `.agents/` produced neither a link nor a reference-broken issue). The pinned grammar in `architecture.md` documents the widening; URLs, placeholders and double-dot typos stay rejected.

## User-facing

References to files under hidden folders like `.claude/` now draw their arrows on the map, both as backticked paths and as @-mentions. Before, they were silently ignored.
