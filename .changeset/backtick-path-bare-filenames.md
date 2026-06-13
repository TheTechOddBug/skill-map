---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

`core/backtick-path` now matches bare `.md` filenames inside code spans, not only slashed paths: a backticked `` `algo4.md` `` becomes a `points` edge the way the runtime follows it. The `/` separator is now optional, with the first path segment anchored to a word char so globs and placeholders (`{PROJECT}-x.md`, `*-S.md`) stay rejected. Slashless names like `SKILL.md` match too; a self-reference becomes a self-loop, other misses flag via `core/reference-broken`.

## User-facing

Backticked filenames now become links even without a folder: writing `` `algo4.md` `` inside code formatting (not just `` `docs/algo4.md` ``) draws an arrow to that file in the graph, matching how an agent actually follows the reference.
