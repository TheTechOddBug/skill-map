---
"@skill-map/cli": minor
---

Adds `core/ai-summarizer-action`, the first probabilistic built-in Action: it summarizes a `markdown` node into a structured brief. It ships experimental (disabled by default; opt-in via `sm plugins enable core/ai-summarizer-action`). Built-in probabilistic Actions now inline their `prompt.md` and `report.schema.json` via the built-ins codegen (new optional `IAction.promptTemplate` / `reportSchema`), so `sm job submit` resolves the template with no on-disk source dir.
