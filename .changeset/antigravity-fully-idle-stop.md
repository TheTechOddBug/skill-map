---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Antigravity live-activity fix: the conversation Stop only releases the owner's claims when the conversation is FULLY idle (fullyIdle is not false). The runtime fires Stop on every mid-run nap while subagents work (live-verified 2026-07-05), and releasing there darkened the whole chain prematurely; nap stops now disclaim, a missing fullyIdle keeps the old behavior for older runtimes. The per-provider spec table also pins why spawn relations are unmappable on this runtime.

## User-facing

On Antigravity, the map no longer goes dark while the main conversation waits for its subagents; everything stays lit until the whole conversation actually finishes.
