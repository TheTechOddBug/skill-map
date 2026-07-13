---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Removes the `writesSummary` flag from the Action contract. An Action is now a summarizer iff its `report.schema.json` extends a canonical `summaries/<kind>.schema.json` via `$ref`; `sm record` detects the signal from the schema and upserts the validated report into `state_summaries`. The kernel AJV now registers the `summaries/*` schemas so report schemas can reference them.
