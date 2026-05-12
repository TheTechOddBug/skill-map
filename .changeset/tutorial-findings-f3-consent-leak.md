---
"@skill-map/cli": patch
---

Tutorial F3 — close consent-gate leak across user-level config layers. `allowEditSmFiles`, `scan.extraFolders`, and `scan.referencePaths` are spec'd as project-local-only, but the loader's strip used to fire only on the committed `project` layer; values in `user` / `user-local` / `override` survived and silently granted consent (or applied paths) in every project. Now stripped from every non-project-local layer, with a directed warning naming the offending layer + key.

Behaviour change for operators: a `~/.skill-map/settings.json` or `~/.skill-map/settings.local.json` that carries any of these three keys will emit a warning on the next load and the value will not apply. Move the key into `<project>/.skill-map/settings.local.json` (per-checkout, gitignored) to retain the intent.

## User-facing

`sm` now refuses to grant the `.sm` write consent (or apply `scan.extraFolders` / `scan.referencePaths`) when those keys live in `~/.skill-map/settings.json`. The first prompt re-appears per project. Move any stray values into `<project>/.skill-map/settings.local.json` (gitignored).
