---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Remove the `-g/--global` flag and every implicit `$HOME` read from
skill-map. The CLI now operates exclusively on the project scope
(`<cwd>/.skill-map/`); there is no global / user scope, no
`SKILL_MAP_SCOPE` env var, no silent merge of user-level config or
plugins.

The user extends the scan beyond the project root via the existing
`scan.extraFolders` setting in project-local config (privacy-gated
through `sm config set --yes` or the Settings UI confirm dialog).
Plugins outside the project install per-project at
`<cwd>/.skill-map/plugins/` or load via the `--plugin-dir <path>`
escape hatch on the `sm plugins …` verb family.

**Narrow documented exception**: a single `~/.skill-map/settings.json`
file (validated by `user-settings.schema.json`) holds genuinely
per-machine preferences. Today it carries the update-check toggle +
its throttle bookkeeping; future per-machine settings (locale, theme)
extend it under their own sub-keys. There is no `.local` partner.
The file is NOT part of the project config layer system; it is read
directly by the module that owns each feature. `src/cli/util/user-settings-store.ts`
is the only module that calls `os.homedir()` for this file. The two
remaining `os.homedir()` callsites (`core/config/helper.ts`,
`core/runtime/reference-paths-walker.ts`) handle user-typed `~/foo`
expansion inside `scan.extraFolders` / `scan.referencePaths`, the
read is user-authored per invocation, not skill-map's own default.

Removed surface (`@skill-map/cli`):

- `-g/--global` flag inherited by every `SmCommand` verb (`bump`,
  `check`, `config`, `export`, `graph`, `history`, `init`, `jobs`,
  `list`, `orphans`, `refresh`, `scan`, `serve`, `show`, `sidecar`,
  `watch`, every `plugins` subcommand). Calling any verb with
  `-g/--global` now exits 2 with Clipanion's "unknown option" error.
- `SKILL_MAP_SCOPE=global` env var translation.
- `sm serve --scope project|global` flag.
- `sm config --source global` literal in `--source` outputs (the
  source set is now `default | project | project-local | env | flag`).
- `IRuntimeContext.homedir` field.
- `IDbLocationOptions.global` field; `resolveDbPath` reduces to
  `db ?? defaultProjectDbPath(ctx)`.
- `defaultUserPluginsDir` helper.
- `loadConfig` `scope: 'project' | 'global'` parameter and the
  `user` / `user-local` file-pair iteration; the layer list is now
  `defaults` → `project` → `project-local` → `override`.
- `USER_ONLY_KEYS` constant and the per-key locality enforcement
  pinned to it. `updateCheck.enabled` is no longer part of the
  config layer system; its toggle lives alongside the throttle
  cache.
- `GET /api/health` response field `scope: 'project'|'global'`.
- `GET /api/plugins` item field `source: 'built-in'|'project'|'global'`
  reduces to `'built-in'|'project'`.
- `scan_meta.scope` SQLite column and the matching `IScanResult.scope`
  kernel field.

Removed surface (`@skill-map/spec`):

- `spec/cli-contract.md` § Global flags row for `-g/--global` and
  the `SKILL_MAP_SCOPE` row in the env-var table.
- `spec/cli-contract.md` § serve flag table `--scope project|global`
  row.
- `spec/architecture.md` § Config layering layers `user` and
  `user-local`; `USER_ONLY_KEYS` set.
- `spec/db-schema.md` two-scope diagram; `scan_meta.scope` column;
  `scope: 'global'` from `--source` enum text.
- `spec/schemas/scan-result.schema.json` `scope` property (was in
  `required`).
- `spec/schemas/project-config.schema.json` `updateCheck`
  description rewritten as the documented exception.
- `spec/schemas/plugins-registry.schema.json` status description's
  `project / global / --plugin-dir` reference.

Added surface:

- `spec/cli-contract.md` § "Scope is always project-local"
  normative paragraph at the top of the file, stating the
  no-`$HOME`-reads principle and the update-check exception.
- `AGENTS.md` § Analyzers gains the matching operating rule for
  agents working in the repo, "Skill-map MUST NEVER read `$HOME`
  by default…".
- Regression test at `src/test/global-flag-removed.test.ts`
  asserting Clipanion's "unknown option" error on `sm scan -g`.

Migration (no compat shim): pre-1.0, greenfield. Users who relied
on `~/.skill-map/skill-map.db`, `~/.skill-map/settings*.json`, or
`~/.skill-map/plugins/` move the files into their project
(`<cwd>/.skill-map/`) or pass `--plugin-dir <path>` per invocation.
Older DBs are not migrated, a fresh `sm init` regenerates without
the `scope` column.

## User-facing

`-g/--global` is gone. `sm` reads only the current project
(`<cwd>/.skill-map/`). To scan outside the project, add paths via
`scan.extraFolders` in Settings. User-scope plugins move to
`<cwd>/.skill-map/plugins/` or load with `--plugin-dir <path>`.
