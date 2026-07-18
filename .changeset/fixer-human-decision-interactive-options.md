---
'@skill-map/cli': patch
---

The prose fixers now RESOLVE a choice only the author can make by asking, not deferring: their prompts direct the processing agent to present the concrete options as a choose-one question (an `AskUserQuestion`-style prompt) and apply the pick in-session (recorded `fixed` / `by: human`), falling back to a `human-decision` note only when the run is non-interactive. The `sm-process-jobs` skill was aligned to permit the choose-one interaction.

## User-facing

When an AI fix needs a call only you can make, the agent now asks you to pick from concrete options right there (via the Claude Code question interface) and applies your choice, instead of only leaving a note for later.
