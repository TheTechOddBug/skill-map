---
'@skill-map/cli': patch
---

Security hardening pass from the cli-hacker audit. Untrusted YAML now parses behind a single bounded entry point (a ~500-byte frontmatter of nested anchors could exhaust the heap and take `sm serve` down). Bumps `js-yaml` and overrides `fast-uri` / `qs` / `body-parser`, clearing every production-reachable advisory. Also tightens the project DB and its backups to `0600`, sanitises `sm watch` output, redacts non-home project roots from telemetry, and announces plugins whose code was imported.

## User-facing

Hardening. A malformed or hostile file can no longer crash a scan or a running server, the project database and its backups are now readable only by you, and skill-map tells you when a project-local plugin's code runs.
