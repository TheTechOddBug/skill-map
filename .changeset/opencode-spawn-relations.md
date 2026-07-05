---
"@skill-map/spec": patch
"@skill-map/cli": minor
---

OpenCode live-activity spawn parity: the in-process plugin forwards tool.execute.after wiring-filtered to the task tool, and the adapter emits spawn relations from the task pair (callID as spawnId, prompt on start, the child sessionID plus its final report unwrapped from the task_result envelope on completion, relation-only since the task event never names the parent agent). session.idle confirmed nap-free; spec table updated from the 2026-07-05 probe.

## User-facing

OpenCode sessions now draw spawn arrows with per-edge conversation counters and opt-in conversation viewing, with the child's full reply captured natively; the demo fixture mirrors the Claude one (3-turn conversation, unlinked scout, report skill).
