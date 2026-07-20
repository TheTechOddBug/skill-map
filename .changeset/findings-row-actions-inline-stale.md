---
"@skill-map/cli": minor
---

Findings workbench: each finding row carries its own actions (auto-fix via the finder fixers, mark fixed, dismiss, restore, delete), hidden buckets render as reveal chips, a finder with open findings sits disabled, and the ALL button submits sequentially, finders first then actions. Stale findings show inline marked `(stale)` instead of hiding, `human-decision` rows read `needs decision`, the Activity section survives server restarts, and deleting a `.sm` no longer hides its `.md` until rescan.

## User-facing

**Fix findings from the row.** Each finding now has its own fix, dismiss, and delete buttons; stale findings show inline with a stale mark instead of hiding; a finder with open findings waits until you handle them; and deleting a `.sm` no longer hides its file until rescan.
