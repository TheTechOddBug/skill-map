---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Plugin extensions declare operator-configurable `settings` in their manifest, read at scan time via `ctx.settings` and resolved through the config layers under `plugins.<id>.extensions.<extId>.settings`. The `sm plugins config <plugin>/<ext>` verb, `GET`/`PATCH /api/plugins`, and a per-extension form in Settings, Plugins all read and write them; `secret` values route to the gitignored project-local file (no encryption). Adds a `number` (decimal) input-type to the catalog.

## User-facing

Plugin extensions can expose options: edit them in Settings, Plugins or via `sm plugins config <plugin>/<ext>` (saved in `.skill-map/settings.json`; secrets stay in the local file, never committed). Run `sm scan` to apply. New decimal `number` option type.
