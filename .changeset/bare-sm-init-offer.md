---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Bare `sm` (no arguments) in a folder that has files but no `.skill-map/` project now offers to bootstrap it: on an interactive terminal it shows a yes/no confirm (default yes) that runs `sm init` and, on success, continues into the Web UI server (`sm serve`). Declining, a non-interactive stdin, or an empty folder keep the previous behavior (the getting-started menu or the one-line hint plus exit 2).

## User-facing

Run `sm` in a folder that already has files but no project and it now offers to set skill-map up for you; accept and it initializes, scans, and opens the map.
