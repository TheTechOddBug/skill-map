---
"@skill-map/cli": minor
---

Adds `core/ai-summarizer-action`, the first probabilistic built-in Action: it summarizes a `markdown` node into a structured brief (`whatItCovers` plus optional topics/keyFacts/etc.), submittable and previewable today. Built-in probabilistic Actions now inline their `prompt.md` and `report.schema.json` via the built-ins codegen (new optional `IAction.promptTemplate` / `reportSchema`), so `sm job submit` resolves the template with no on-disk source dir. Runner and record land later.
