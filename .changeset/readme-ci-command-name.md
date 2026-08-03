---
"@skill-map/cli": patch
---

Correct the published README's developer-commands block: it claimed CI runs `pnpm validate` (untrue since CI split into parallel `cli` and `ui` lanes), described the root orchestrator rather than the workspace-local one a reader standing in this package would get, and announced "two extra scripts" above a list of four. Each entry now says what it does and where it runs from. Documentation-only change, no runtime behaviour affected.
