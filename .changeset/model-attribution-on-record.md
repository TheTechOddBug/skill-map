---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

`sm record --model <name>` is now persisted instead of dropped: the agent's self-declared model id lands on `state_executions.model` and is denormalized onto the `state_findings.model` / `state_summaries.model` rows the same record writes, so every probabilistic analysis answers "which model, when" without joins. `sm findings` renders it alongside the confidence, and the drain skill instructs agents to declare it.

## User-facing

Analyses now remember which AI model produced them: agents report their model when closing a job, and `sm findings` / `sm show` display it next to each result together with its date.
