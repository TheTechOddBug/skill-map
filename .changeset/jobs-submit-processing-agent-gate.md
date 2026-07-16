---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Processing-agent gate on `sm jobs submit`: with no `sm-process-jobs` skill installed under any Provider destination, the submit now refuses (exit 2) with an advisory explaining the pull-only mechanism and the remedy (`sm agent install`), instead of enqueuing work nothing will ever claim. An installed-but-outdated skill passes with a refresh advisory; the auto-fix hook's internal fixer submits bypass the gate. New conformance case `jobs-submit-agent-gate`.

## User-facing

Submitting an analysis job now checks that an agent is actually set up to run it: if you never ran `sm agent install`, the submit stops and tells you how the queue works instead of leaving the job waiting forever.
