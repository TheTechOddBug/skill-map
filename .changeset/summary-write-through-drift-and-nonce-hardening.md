---
"@skill-map/spec": minor
---

A new `writesSummary` Action-schema flag drives a `state_summaries` write-through when `sm record` closes a completed job, shown (with a `(stale)` marker) by `sm show`. Tightens the `</user-content>` escaping to be case/whitespace-insensitive, adds a submit-time body-hash drift check that refuses stale bytes, hides a job's `nonce` from `job list`/`show --json`, has read verbs advise not refuse on schema drift, and reconciles the `sm record` exit codes (2 = not running, 5 = not found).
