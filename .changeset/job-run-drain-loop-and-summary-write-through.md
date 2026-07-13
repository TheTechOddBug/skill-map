---
"@skill-map/cli": minor
---

Adds `sm job run [--all] [--max N]`, the CLI-runner drain loop that reaps, claims, runs, and records jobs against `claude -p --output-format json` (or a mock runner). `sm record` now writes a summarizer Action's report through to `state_summaries`, shown by `sm show` with a `(stale)` marker. A review hardening pass escapes the `</user-content>` injection delimiter case/whitespace-insensitively, strips the `nonce` from `job list`/`show --json`, and verifies the on-disk body hash at submit.

## User-facing

**Run your job queue against the LLM.** `sm job run` (and `--all`) now runs and records jobs end-to-end through `claude`. Two security fixes: a job's record credential no longer leaks via `job list`/`show --json`, and the injection delimiter resists cased or padded close tags.
