---
"@skill-map/cli": minor
---

`sm doctor` lands for real: eight read-only checks (PRAGMA quick_check, pending migrations, orphan history rows, job-content consistency, job GC stragglers, plugins in error state, `claude` runner availability with version, detected providers that matched no nodes), exit 0/1/2 per the contract, `--json` envelope included. `sm actions list` / `sm actions show <id>` replace their stubs with the composed manifest view (mode, precondition, expected duration, report schema ref, summarizer detection).

## User-facing

**Health check and action catalog.** `sm doctor` now reports DB integrity, pending migrations, queue consistency, broken plugins, and whether the `claude` runner is installed. `sm actions list` shows every action you can queue, `sm actions show <id>` its full manifest.
