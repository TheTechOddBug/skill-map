---
"@skill-map/cli": minor
---

The `@<file>` and `/<command>` grammars are consolidated into one vendor-neutral pair of `core` extractors (`core/at-file`, `core/slash-command`), each gated by `precondition.provider` to the lenses whose runtime reads that syntax. Antigravity now draws `@filename` file references (a file-shaped `@path` becomes a path-resolved `references` edge, the file-picker grammar Codex already had); `claude/at-directive` narrows to bare-handle agent mentions.

## User-facing

Antigravity projects now draw `@filename` file references on the map: an `@path` token in a workflow or skill body becomes an arrow to that file, the same file-picker behavior Codex already had.
