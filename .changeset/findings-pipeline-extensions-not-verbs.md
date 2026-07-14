---
'@skill-map/spec': minor
---

Semantic capabilities ship as extensions, not verbs (Decision #137): the planned LLM-verb set is dropped and `sm findings` becomes the generic reader of the new `state_findings` table. Probabilistic Analyzers (finders) share the job queue via `prompt.md` plus a report schema extending the new canonical `findings/report.schema.json`; `sm record` routes analyzer reports to findings and derives safety rows from any probabilistic report. `state_jobs` renames `action_id` to `extension_id`.
