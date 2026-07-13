---
"@skill-map/spec": minor
---

The summarizer is universal: the per-kind summary schemas (`summaries/{skill,agent,command,hook}.schema.json`) are removed and `summaries/markdown.schema.json` becomes the single canonical node-summary shape (`markdown` names the body format every node shares, not the node kind). The summarizer detection convention in `job-lifecycle.md` §Record is now "report schema extends a schema under `summaries/`"; per-kind summarizers are dropped from the plan.
