---
"@skill-map/cli": patch
---

`sm refresh`: redesign the human renderer to a single result line in the
rhythm of the recent `sm scan` / `sm list` / `sm config list` polish.

The old shape printed a mid-action banner on stderr ("Refreshing
enrichments for X" / "Refreshing N stale rows across M nodes") and then
a post-action "Persisted N enrichment row(s)" on stdout. Two channels,
two messages, redundant with the elapsed-time footer on stderr that the
shared command runner already emits.

New shape — one line on stdout per outcome:

- `✓  N enrichment row(s) from <node.path>` for `sm refresh <path>`.
- `✓  N enrichment row(s) across M node(s)` for `sm refresh --stale`.
- `✓  No stale enrichment rows.` when `--stale` finds nothing.
- `✕  Node not found: <path>` + dim hint on stderr for the lookup miss
  (replaces the prose `sm refresh: node not found in the persisted
  scan: …` two-sentence wall).

Plural-correct nouns (`row` vs `rows`, `node` vs `nodes`) and ANSI
colour for the glyph (green tick, red cross, dim hint) wired through
the existing `ansiFor` helper so `--no-color` and non-TTY pipes drop
back to plain text. Validation / failure copy (`refreshFailed`,
`nodeAndStaleMutex`, `noTargetSpecified`, `readFailedDetail`) is
untouched — those are argparse-tier errors, not result output.

Tests in `src/test/node-enrichments.test.ts` updated to match the new
stdout/stderr split and the case-insensitive copy. No spec, kernel, or
flag-surface change; CLI reference output is identical.
