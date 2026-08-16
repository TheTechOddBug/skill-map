---
'@skill-map/cli': minor
---

`sm serve` now journals each runtime session to `.skill-map/sessions/` (one JSON file per session, resolved content-free frames, gated by the new `activity.journal.enabled` key, default on), and `sm scan` folds the journal for the new `core/observed-link-missing` analyzer: one `info` issue per node observed invoking or spawning a target no declared link covers, grouped under "Observed in sessions" in the inspector, dismissible via the standard issue suppression.

## User-facing

skill-map now remembers your AI sessions on disk and, at the next scan, points out things your agents actually used that your files never mention, under "Observed in sessions", so you can add the missing reference or dismiss the hint.
