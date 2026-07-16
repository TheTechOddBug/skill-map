---
'@skill-map/cli': patch
---

The incomplete-namespace hint (`sm jobs` with no subcommand) no longer passes off a three-item sample as the full list: past three subcommands the line reads `..., and N more.` so `Available subcommands:` stops implying exhaustiveness. Observed live on `sm jobs`, which showed 3 of its 9.

## User-facing

Typing a bare namespace like `sm jobs` now tells you how many more subcommands exist beyond the three examples shown, instead of looking like a complete list.
