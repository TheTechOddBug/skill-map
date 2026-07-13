---
"@skill-map/cli": minor
---

Adds `sm record --id <id> --nonce <n> --status completed|failed`, the nonce-authenticated callback that closes a running job. A nonce mismatch exits 4 (no mutation), a non-running job exits 2, an unknown job exits 5. On `completed` the `--report <path|->` payload is validated against the action's report schema (invalid marks the job `failed`/`report-invalid`, exit 2), then the execution row and terminal transition are written in one transaction. Closes the submit, claim, record loop.
