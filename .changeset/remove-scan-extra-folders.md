---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Remove the `scan.extraFolders` config key. Project-local persistent
extension of the indexed scan no longer exists; to walk a directory
outside the project root pass it as a positional argument to
`sm scan [roots...]` (per-invocation, not persisted). The narrower
`scan.referencePaths` key (validate links against on-disk files
without indexing them) is unaffected.

**Spec (`spec/`):**

- `spec/schemas/project-config.schema.json`: `extraFolders` block
  deleted. `scan.referencePaths` description trimmed of cross-
  references and now reads stand-alone.
- `spec/architecture.md` §Config layering: `PROJECT_LOCAL_ONLY_KEYS`
  catalogue drops `scan.extraFolders`.
- `spec/plugin-author-guide.md`: the "the only way to scan paths
  outside the project is `scan.extraFolders`" sentence rewrites to
  point at positional roots.
- `spec/index.json` regenerated.

**Kernel + config (`src/kernel/`, `src/config/`, `src/core/config/`):**

- `IScanConfig` drops `extraFolders: string[]`.
- `PROJECT_LOCAL_ONLY_KEYS` and `PRIVACY_SENSITIVE_KEYS` lose the
  entry.
- `projectPathExposure` collapses the two-branch list-check to one.
- `defaults.json` drops the `extraFolders: []` line.

**Runtime (`src/core/runtime/`):**

- `resolveScanRoots(inputs)` simplifies to `{ positionalRoots } =>
  string[]`; no more `IScanRootsInputs.extraFolders`,
  `IScanRootsResolution.fromExtra`, or `emitRootsAdvisory()`.
- The `includingExtraFoldersAdvisory` text catalog entry is removed.

**CLI (`src/cli/`):**

- `sm scan` help text loses the extraFolders sentence; positional
  roots are now the documented way to extend the scan.
- `sm serve` boot banner reads only `scan.referencePaths` from the
  effective config; the banner row labelled `Extras` (and the
  matching shape on `IBannerInput` / `IFigletInput`) is removed.
  `Refs` stays.
- `sm config set --yes` description trimmed to reflect the single
  privacy-sensitive key remaining.

**Server (`src/server/`):**

- `WatcherService` no longer reads config to compute roots; it walks
  `['.']` unconditionally. `loadConfig` and `resolveScanRoots`
  imports drop. `restart()` is still useful (and still wired by
  `PATCH /api/project-preferences`) so the side-set walk picks up
  fresh `scan.referencePaths` on the next batch.
- `PATCH /api/project-preferences`: AJV body schema, `IPatchBody`,
  `IProjectPreferencesEnvelope`, `IPlannedWrite.key`, `collectWrites`
  all collapse to a single `referencePaths` branch.
- Catalog strings adjusted (the `extraFolders` example dropped from
  `projectPrefsScanNotObject` etc).

**UI (`ui/src/`):**

- Settings → Project drops the entire `extraFolders` row (HTML, TS
  signal + computed + add/remove handlers, i18n strings, mocks).
- `IProjectPreferencesApi` and `IProjectPreferencesPatchApi` lose
  `extraFolders`.
- Test mocks (`app.spec.ts`, `graph-view.spec.ts`,
  `inspector-view.spec.ts`) updated.

**Tests:**

- `server/routes/__tests__/project-preferences-route.spec.ts`: 5
  PATCH cases remapped from `extraFolders` to `referencePaths`.
- `kernel/config/__tests__/config-loader.spec.ts`: strip-test
  renamed and split.
- `core/runtime/__tests__/scan-roots.spec.ts`: drops 3 cases that
  passed `extraFolders`; keeps the positional + default cases.
- `core/config/__tests__/config-helper.spec.ts`:
  `PROJECT_LOCAL_ONLY_KEYS` catalogue assertion narrowed; the
  `target=project` rejection test now targets `scan.referencePaths`.

**Backward compatibility note**: existing `settings.local.json` files
that still carry `scan.extraFolders` keep loading without error. The
loader's per-key resilience drops the unknown key with a generic
"unknown key ignored" warning; nothing crashes, the rest of the file
takes effect. Operators who relied on the key should switch to
positional roots on `sm scan`.

## User-facing

We removed `scan.extraFolders`. To extend the scan beyond the project root, pass folders as positional arguments to `sm scan [roots...]`. The `scan.referencePaths` key (validates links against on-disk files without indexing) is unchanged. Existing entries are silently ignored.
