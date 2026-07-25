---
"@skill-map/cli": patch
---

The contradiction fixer's prompt no longer describes asking the author as an `AskUserQuestion`-style options widget with `human-decision` as the fallback for "cannot interact". Runtimes without such a widget read that as permission to defer, so a decision the operator was sitting there to make got recorded as pending instead of asked. The instruction is now capability-neutral: ask in whatever channel you normally reply in, and reserve `human-decision` for genuinely unattended runs.

## User-facing

When a contradiction needs your call, the fixer asks you in chat and applies your answer, instead of quietly parking it for later on agents without a dedicated question widget.
