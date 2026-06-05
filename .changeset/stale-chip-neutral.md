---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

The `core/annotation-stale` analyzer is now neutral instead of warning-tinted: drift is informational, not a warning. Its footer chip (`staleIcon`) carries no severity (the clock renders in the foreground colour instead of the warn tint), and the stale Findings issue is lowered from `warn` to `info`. As `info`, it no longer counts toward the card's warn chip (the issue-counter buckets error/warn only) and never affected `sm check`'s exit code (info and warn are both non-failing).
