---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

`sm plugins show <plugin>/<ext>` now renders a probabilistic extension's two contract files inline: the verbatim `prompt.md` template under a Prompt section and the pretty-printed `report.schema.json` under a Report schema section (`--json` gains `promptTemplate` / `reportSchema`). The prompt is the extension's essence under the forms model, so the inspector surfaces it without disk spelunking.

## User-facing

`sm plugins show` now displays the full prompt and answer format of any LLM-backed extension, so you can read exactly what a queued job will ask an agent to do before submitting anything.
