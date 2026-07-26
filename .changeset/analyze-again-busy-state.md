---
'@skill-map/cli': patch
---

The inspector's AI busy states are now honest about the queue phase everywhere: the summary block's "Analyze again" button disables with a clock while queued and a spinner while running (mirroring the header affordance), and the per-finding Auto-fix and per-issue fix buttons pin the clock while the fixer job is queued instead of jumping straight to the spinner, the same clock-then-spin convention the launchers already followed.

## User-facing

Fix buttons now show a clock while the job waits in the queue and a spinner only once your agent is actually running it, so you can tell "waiting" from "working" at a glance.
