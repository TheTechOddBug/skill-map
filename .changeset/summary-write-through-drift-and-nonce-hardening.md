---
"@skill-map/spec": minor
---

Summarizer Actions (report schema extends `summaries/<kind>`) drive a `state_summaries` write-through when `sm record` closes a completed job, shown by `sm show` with a `(stale)` marker. Tightens the `</user-content>` escaping to be case/whitespace-insensitive, adds a submit-time body-hash drift check refusing stale bytes, hides the `nonce` from `job list`/`show --json`, has read verbs advise not refuse on schema drift, and reconciles the `sm record` exit codes (2 = not running, 5 = not found).
