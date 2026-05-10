---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Add `sm scan -g` (global scan) plus three privacy-sensitive project scan settings: `scan.includeHome`, `scan.extraRoots`, `scan.referencePaths`. Settings UI exposes them in a new "Project" section.

**Spec changes** (`@skill-map/spec`, minor):

- `spec/cli-contract.md` § Scan — `sm scan -g/--global` flag documented: with `-g` the scan walks every active Provider's `explorationDir` resolved against `~` (typically `~/.claude`, `~/.gemini`, `~/.agents`) instead of the cwd; config + DB resolve from the global scope. Mutually exclusive with positional roots (exit `2`). New §Effective roots subsection enumerates how the resolver composes `cwd` + `includeHome` + `extraRoots` + `-g`.
- `spec/cli-contract.md` § Config — `sm config set` gains an optional `--yes` flag and a new §Privacy-sensitive config subsection: writes that EXPAND disk access outside the project (toggling `scan.includeHome` `false`→`true`, adding out-of-project paths to `scan.extraRoots` / `scan.referencePaths`) require `--yes` to confirm. Writes that NARROW the surface need no flag.
- `spec/schemas/project-config.schema.json` — `scan` block grows three keys:
  - `includeHome: boolean` (default `false`).
  - `extraRoots: string[]` (default `[]`).
  - `referencePaths: string[]` (default `[]`).
  Every key carries a "privacy-sensitive" warning in its description so the schema-as-doc stays honest.
- `spec/index.json` regenerated.

**Implementation changes** (`@skill-map/cli`, minor):

- `src/config/defaults.json` — three new defaults under `scan` (`includeHome: false`, `extraRoots: []`, `referencePaths: []`).
- `src/kernel/config/loader.ts` — `IScanConfig` gains `includeHome`, `extraRoots`, `referencePaths`. Each documented inline as privacy-sensitive.
- `src/kernel/extensions/rule.ts` — `IRuleContext` gains optional `referenceablePaths?: ReadonlySet<string>` (the side index `core/broken-ref` consults) and `cwd?: string` (absolute project root, threaded so rules can resolve relative `link.target`s without heuristics).
- `src/kernel/orchestrator.ts` — `RunScanOptions.referenceablePaths?` and `RunScanOptions.cwd?` propagate through `runScanInternal` → `runRules` → per-rule `evaluate()`.
- `src/core/runtime/scan-roots.ts` (new) — `resolveScanRoots({ positionalRoots, scope, cwd, homedir, providers, includeHome, extraRoots })`. Centralises the spec's § Effective roots rules: positional roots win verbatim; otherwise compose cwd + (includeHome ? HOME provider dirs : []) + extraRoots for project scope, or HOME provider dirs only for global scope. `-g` + positional roots throws.
- `src/core/runtime/reference-paths-walker.ts` (new) — `walkReferencePaths(rawRoots, cwd, homedir)` returns `{ paths: Set<absolute>, truncated, missingRoots }`. Recursive walk that skips symlinks + `node_modules`/`.git`/`.skill-map`; capped at `REFERENCE_WALK_MAX_FILES` (50_000) for safety.
- `src/core/runtime/scan-runner.ts` — `IScanRunOpts.scope?: 'project' | 'global'` (default `'project'`). Resolves DB via `resolveDbPath({ global: scope === 'global', ... })`, `loadConfig` honours the scope, roots resolve via `resolveScanRoots`, reference paths walk via `walkReferencePaths`, and the resolved `cwd` + `referenceablePaths` thread into `RunScanOptions`. Emits stderr advisories for HOME inclusions and reference-walk truncation / missing roots. The `runOptions` assembly extracted to a `buildRunScanOptions` helper to stay under the cyclomatic-complexity cap.
- `src/core/runtime/i18n/scan-runner.texts.ts` — three new strings (`includingHomeAdvisory`, `includingExtraRootsAdvisory`, `referenceWalkTruncated`, `referenceWalkMissingRoot`).
- `src/built-in-plugins/rules/broken-ref/index.ts` — refactored to consult `ctx.referenceablePaths` after the in-graph lookup misses. A path-style link target whose absolute resolution (`resolve(ctx.cwd, link.target)`) is in the side index is treated as resolved (file exists outside the indexed graph). Trigger-style links (`/foo`, `@bar`) skip the side-index lookup. The orchestrator's helper extracted to keep the rule under the complexity cap.
- `src/cli/commands/scan.ts` — wires `-g/--global` to `runScanForCommand`'s new `scope` option. Mutex with positional roots is rejected up front with a directed message (`SCAN_TEXTS.globalWithRoots`).
- `src/cli/commands/config.ts` — `ConfigSetCommand` gains `--yes`. When the key is in `PRIVACY_SENSITIVE_KEYS` and the new value would expand the surface, the verb prints the list of paths the change would expose and exits `2` unless `--yes` is set; with `--yes` it prints the same list as a confirmation receipt.
- `src/cli/i18n/config.texts.ts` — `privacyGateRequired` / `privacyGateRequiredHint` / `privacyGateConfirmed`.
- `src/cli/i18n/scan.texts.ts` — `globalWithRoots`.
- `src/core/config/helper.ts` — adds `PRIVACY_SENSITIVE_KEYS` (a `ReadonlySet<string>`) and `projectPathExposure({ key, value, cwd, homedir })` that returns `{ expandsSurface, exposedPaths }`. Same predicate is consumed by both the CLI verb and the BFF route so the wire-side and CLI-side behaviour stay symmetric.

**BFF additions**:

- `src/server/routes/project-preferences.ts` (new) — `GET /api/project-preferences` returns `{ scan: { includeHome, extraRoots, referencePaths } }`; `PATCH /api/project-preferences` writes via `core/config/helper:writeConfigValue` with `target: 'project'`. Privacy-sensitive writes that expand the surface require `confirm: true` in the body — otherwise the route returns 412 `confirm-required` with the list of paths the change would expose.
- `src/server/i18n/server.texts.ts` — eight new strings under the project-preferences section.
- `src/server/app.ts` — registers the new route + adds `'confirm-required'` to `TErrorCode`; `codeForStatus(412)` maps to it.

**UI additions** (private `ui/` workspace):

- `ui/src/app/components/settings-modal/settings-project.{ts,html,css}` (new) — Project section. Renders the `includeHome` toggle plus two editable path lists (`extraRoots`, `referencePaths`) with add / remove controls. A `<p-confirmdialog>` enumerates the paths a privacy-sensitive change would expose; on accept the patch is re-issued with `confirm: true`.
- `ui/src/app/components/settings-modal/settings-modal.{ts,html}` — `Project` added to the sidebar between `General` and `Plugins`. New `projectVisible` computed signal mirrors the General / Plugins lifecycle.
- `ui/src/i18n/settings.texts.ts` — `sections.project` + `project: { heading, intro, includeHomeLabel, includeHomeDescription, extraRootsLabel, extraRootsDescription, extraRootsPlaceholder, referencePathsLabel, referencePathsDescription, referencePathsPlaceholder, addPathLabel, removePathLabel, confirmDialogHeader, confirmDialogIntro, confirmDialogAccept, confirmDialogReject }`.
- `ui/src/models/api.ts` — new `IProjectPreferencesApi` and `IProjectPreferencesPatchApi` types (mirroring the BFF shape).
- `ui/src/services/data-source/data-source.port.ts` — `IDataSourcePort` gains `getProjectPreferences()` / `setProjectPreferences(patch)`. `RestDataSource` and `StaticDataSource` implementations updated.
- Two pre-existing test stubs (`ui/src/app/app.spec.ts`, `ui/src/app/views/graph-view/graph-view.spec.ts`) extended with the two new methods.

**Tests**:

- New `src/test/scan-roots.test.ts` — exhaustive coverage of `resolveScanRoots` permutations (positional verbatim, `-g` mutex throw, project / global derivations, dedup).
- New `src/test/reference-paths-walker.test.ts` — recursive walk, missing roots, symlinks skipped, skip-list dirs, multi-root.
- New `src/test/project-preferences-route.test.ts` — boots `createServer()` against a tempdir cwd / homedir; covers default `GET`, the `confirm-required` 412 on expansion, the `confirm: true` round-trip, and 400 body-shape errors.

**Pre-1.0 minor bumps** per `spec/versioning.md` § Pre-1.0 — both surfaces grow additively (one new flag on `sm scan`, three new optional config keys, one new BFF route, one new UI section). Existing `scan` invocations behave identically with the new defaults (every new key defaults to the historical zero-state).

## User-facing

**`sm scan -g` now scans your HOME directory.** Run `sm scan -g` (without positional roots) to walk every active provider's HOME dir — typically `~/.claude`, `~/.gemini`, `~/.agents` — using the global config + DB.

**Three new privacy-sensitive project settings.** Open Settings → Project to:
- **Include HOME provider directories** — when on, `sm scan` (without `-g`) also walks `~/.claude`, `~/.gemini`, `~/.agents` alongside your project content.
- **Extra scan roots** — paths you can add to the scan (indexed as nodes alongside the project root).
- **Reference paths (link validation)** — paths walked only to validate links; files there aren't indexed but `core/broken-ref` won't warn when a link target exists in one of them.

Every change that expands disk access beyond your project root requires explicit confirmation: a confirm dialog in the UI listing the paths that will be read, or `sm config set <key> <value> --yes` on the CLI. Writes that narrow the surface (toggling off, removing paths) need no confirmation.
