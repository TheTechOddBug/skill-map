---
'@skill-map/cli': patch
---

The cache-rebuild prompt shown on a version skew (re-scanning a DB written by a different CLI version) is reworded to be shorter and calmer: it no longer recites the pre-1.0 derived-cache rationale or uses "delete" / "deleted" phrasing. The post-rebuild receipt is now suppressed after an interactive y/N confirm (the operator already answered) and only prints for automatic rebuilds (`--yes`, non-TTY, the BFF), where it is the only signal the cache was wiped.

## User-facing

When you upgrade and re-scan, the cache-rebuild prompt is short and reassuring, and once you confirm it no longer prints a redundant "rebuilt" notice. Automatic rebuilds (for example with `--yes`) still show a one-line confirmation.
