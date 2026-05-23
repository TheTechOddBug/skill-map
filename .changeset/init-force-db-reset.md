---
'@skill-map/cli': patch
---

`sm init --force` now wipes the existing `.skill-map/skill-map.db` (and its WAL / SHM sidecars) before provisioning the fresh one, matching the greenfield posture per AGENTS.md: --force means "reset every project artefact", not just the config files. Re-opening a stale DB whose schema predates the current `001_initial.sql` produced `JSON.parse(undefined)` crashes inside `loadScanResult` (columns added post-DB-creation come back as `undefined` from Kysely, and the defensive wrap surfaced them as "Failed to read scan rows" errors on the very next auto-scan); the wipe sidesteps the problem at the right layer instead of bolting in-place ALTER TABLE migrations against the greenfield rule.

The settings.json was already overwritten unconditionally by --force, so a prior `activeProvider` choice does not survive the reset (the bootstrap fires the lens-selection prompt again on the next scan). State-zone tables (LLM jobs, summaries, executions) are reset too, intentional given the "reset the whole project" promise; Phase B users with valuable LLM history should `sm db backup` first.

## User-facing

`sm init --force` now also resets the DB (was overwriting only the config files). Solves the "Failed to read scan rows" crash on the first auto-scan when re-initialising a project that already had a DB from an older CLI version.
