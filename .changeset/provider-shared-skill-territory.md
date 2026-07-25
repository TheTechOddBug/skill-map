---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

A Provider can now declare that it READS a skill territory another Provider owns, via `scaffold.sharedWith`. Antigravity and OpenCode both read the open `.agents/skills` territory that `agent-skills` owns, so `sm agent install` / `status` and the Quick Start row refused under those lenses even though a skill materialised there is discovered by their runtimes. Per-lens probes now resolve them; destination-choice verbs keep listing owners only, so one territory offers one row.

## User-facing

You can now install and check the processing skill from the Antigravity and OpenCode lenses, instead of having to switch to the Agent Skills lens first.
