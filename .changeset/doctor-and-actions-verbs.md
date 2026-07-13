---
"@skill-map/cli": minor
---

`sm doctor` lands for real: seven read-only checks (PRAGMA quick_check, pending migrations, orphan history rows, job-content consistency, job GC stragglers, plugins in error state, detected providers that matched no nodes), exit 0/1/2 per the contract, `--json` envelope included. `sm actions list` / `sm actions show <id>` replace their stubs with the composed manifest view (mode, precondition, expected duration, report schema ref; derived traits carry no field of their own).

## User-facing

**Health check and action catalog.** `sm doctor` now reports DB integrity, pending migrations, queue consistency, and broken plugins. `sm actions list` shows every action you can queue, `sm actions show <id>` its full manifest.
