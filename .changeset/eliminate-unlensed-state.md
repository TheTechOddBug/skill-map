---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The active provider lens no longer has an unlensed (permissive) state. A project with no marker now resolves to the universal `markdown` lens (never null, never persisted, so a later vendor marker still auto-detects) instead of running every provider at once. The Settings dropdown drops the dead `(none)` entry and keeps Markdown as a selectable neutral lens, and `sm serve` now re-scans under the chosen lens after a switch instead of re-detecting it from disk.

## User-facing

A repo with no `.claude/`, `.codex/`, or `.agents/` now opens in the Markdown view instead of mixing every platform together, with no warning. Pick Markdown anytime from Settings to see your files as plain markdown. The empty `(none)` option is gone.
