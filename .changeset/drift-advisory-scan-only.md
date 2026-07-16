---
'@skill-map/spec': patch
'@skill-map/cli': patch
---

Schema-drift advisories now point at `sm scan` alone: scan is a drift-owning verb that deletes and recreates the drifted DB by itself, so the previously prescribed `sm db reset --hard` first step was a redundant detour for the same outcome. The write-refusal, read-failure, and read-warn advisories all drop it (`spec/db-schema.md` §Schema drift).

## User-facing

When your project database is outdated after an upgrade, the error now just says to run `sm scan` (which rebuilds it in one step) instead of a two-command sequence.
