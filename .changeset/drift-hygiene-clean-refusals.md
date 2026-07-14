---
'@skill-map/spec': minor
'@skill-map/cli': patch
---

Schema-drift hygiene for non-drift-owning verbs: read verbs whose query fails because of drift now surface the clean drift advisory (exit 2, naming `sm scan` as the remedy) instead of a raw SQL error, and every row-mutating verb (the `sm job` family, `sm record`, `sm findings prune`, `sm refresh`, `sm plugins trust` / `enable` / `disable`, `sm orphans reconcile` / `undo-rename`) refuses cleanly on drift BEFORE loading the plugin runtime, instead of misleading symptoms like `extension not found`.

## User-facing

When skill-map's local cache predates an upgrade, commands now tell you exactly that and how to fix it (`sm scan`), instead of crashing with a database error or claiming an extension does not exist.
