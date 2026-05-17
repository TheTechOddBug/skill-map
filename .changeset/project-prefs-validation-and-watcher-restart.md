---
'@skill-map/cli': minor
---

Tighten the Settings → Project surface (paths) end-to-end: client + BFF
validation, audit logging on the server console, banner visibility for
the configured roots, watcher hot-reload when `scan.extraFolders`
changes, and a scoped red signal for error banners inside the Settings
modal.

**Server (`src/server/`):**

- `routes/project-preferences.ts`: every PATCH now runs four gates in
  order, AJV (with a new `pattern: '^[^,]+$'` rejecting commas in
  path entries), an existence check (every NEW entry must resolve to
  an existing directory; expands `~` via `resolveScanPath`), the
  privacy gate (412 confirm-required for paths that widen the disk
  surface), and the persist + diff-log step. On success, a `log.warn`
  line per added / removed entry lands on the server stderr with the
  shape `project-prefs: + scan.extraFolders ~/foo (home) → /home/<u>/foo`,
  so the operator running `sm serve` sees scan-config mutations
  without opening the file.
- `watcher.ts`: `IWatcherServiceHandle` adds `restart()`. The factory
  now closes the watcher's scan roots over `loadConfig` so each
  `start()` / `restart()` reads `scan.extraFolders` fresh and routes
  them through `resolveScanRoots` (the same helper the CLI and
  `POST /api/scan` use). Removes the hardcoded `WATCH_ROOT = '.'`.
- `routes/deps.ts` + `app.ts` + `index.ts`: new `IWatcherServiceHolder`
  threaded through `IAppDeps` / `IRouteDeps`. Holder is created
  before `createApp` (so route deps can capture a stable reference)
  and populated once `watcher.start()` returns. Routes guard on
  `holder.current` to support the `--no-watcher` path.
- `core/watcher/runtime.ts`: per-batch runOptions now includes
  `referenceablePaths` + `cwd` when `scan.referencePaths` is set, so
  the server's boot-scan and every chokidar batch match `sm scan`
  behaviour. Previously the watcher silently ignored reference paths
  and emitted false-positive broken-refs.

**CLI banner (`src/cli/`):**

- `util/serve-banner.ts`: optional `extraFolders` and `referencePaths`
  on `IBannerInput`. Each list is rendered as one row per entry
  below `DB`, with the same dim label + value layout as the existing
  `Server` / `Path` / `DB` rows. Empty lists are silent so the
  default banner stays compact.
- `commands/serve.ts`: loads the effective config once at boot and
  feeds both arrays to `renderBanner`.

**UI (`ui/src/`):**

- `app/components/settings-modal/settings-project.ts`: the Add
  handlers reject inputs containing a comma client-side with an
  inline `saveError`, server-side AJV still validates as defense in
  depth.
- `app/components/settings-modal/settings-modal.css`: scoped
  override of `--p-message-error-*` to red inside the settings
  modal. The matrix theme keeps its green retint everywhere else
  (graph + inspector) because errors there are part of the
  immersion; settings form failures need the universal "red =
  danger" signal.
- `app/components/settings-modal/settings-project.css`: margin
  below the `<p-message>` banners so they breathe from the next
  list row.
- `i18n/settings.texts.ts`: new `commaForbidden` message;
  placeholders shortened to a single example each (was a
  comma-separated pair that misled users into pasting lists).

**Tests:**

- `server/routes/__tests__/project-preferences-route.spec.ts`: the
  privacy-gate cases switch from `~/some-folder` (nonexistent) to a
  real tmp dir, the existence gate now runs before the privacy gate
  and would otherwise return 400 before reaching the 412 branch.

## User-facing

Settings now rejects commas in path inputs and refuses paths that don't exist on disk. Adding / removing a folder logs to the server console and live-reloads the watcher, so new nodes appear in the graph without restarting `sm serve` or clicking Scan.
