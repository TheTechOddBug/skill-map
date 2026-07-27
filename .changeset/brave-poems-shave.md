---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Move the generated-artifact ignore rules into a committed `.skill-map/.gitignore` written by the tool itself, replacing the four entries `sm init` appended to the project-root `.gitignore`. The list now also covers the SQLite `-wal` / `-shm` sidecars, the operations log and the generated activity bridge, which the old entries never matched. `sm init`, the scan persist step and `sm activity install` each top it up, so an older project is fixed on its next scan; a `!` negation opts an entry out.

## User-facing

Skill-map no longer writes to your project's `.gitignore`: it keeps its own inside `.skill-map/`, covering everything it generates. The database sidecars, the operations log and the activity bridge no longer show up as files to commit. Older projects are fixed on the next scan.
