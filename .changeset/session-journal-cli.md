---
'@skill-map/cli': minor
---

`sm serve` can now journal runtime sessions to `.skill-map/sessions/` (one content-free JSON per session, captured only while the operator records), and `sm scan` folds the journal for the new `core/observed-link-missing` analyzer: one `info` issue per node observed invoking or spawning a target no declared link covers, under "Observed in sessions" in the inspector, dismissible via the standard suppression. Ships `experimental` (disabled until opted in).

## User-facing

skill-map now remembers your AI sessions on disk and, at the next scan, points out things your agents actually used that your files never mention, under "Observed in sessions", so you can add the missing reference or dismiss the hint.
