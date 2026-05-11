---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Plugin toggles in the Settings modal now apply at the next scan instead of needing an `sm serve` restart. The "Restart required" banner is gone for the common case; only plugins that were disabled at server boot keep a per-row warning because their handlers were never loaded into memory.

**Two issues addressed:**

1. **Latent bug — `POST /api/scan` ignored mid-session toggles.** `runScanForCommand` reused the BFF's boot-cached `pluginRuntime.resolveEnabled`. A user who disabled a plugin and pressed the topbar refresh saw the plugin's contributions reappear. The watcher had the same problem on every chokidar batch (it loads its own bundle once at boot).
2. **No way to cancel.** Each toggle wrote to `config_plugins` immediately and purged `scan_contributions`. Five quick toggles meant five DB round-trips and five purges even if the net state was unchanged.

**Approach** — four layered changes:

- **Fresh resolver per scan.** `composeScanExtensions` / `composeFormatters` / `registerEnabledExtensions` now accept an optional `resolveEnabled` override. The BFF's `POST /api/scan` and the watcher's per-batch loop build a fresh resolver from `config_plugins` via the shared `core/runtime/fresh-resolver.ts` helper before composing extensions, so a toggle made mid-session is honoured on the next scan without restarting the server. Plugin user extensions are now filtered by the same resolver (previously only built-ins were filtered) so disabling a previously-enabled drop-in plugin actually silences it.
- **Boot-time registries cover every built-in.** `kindRegistry` and `contributionsRegistry` (the catalogs embedded in every payload-bearing envelope) used to be seeded from the boot-time `composeScanExtensions(...)` result, which excluded any built-in that started disabled. Re-enabling such a built-in mid-session left its kinds / footer icons unrenderable because the UI's lookup tables never knew about them. Both registries now seed unconditionally from every built-in declaration (their module code is always in memory via `built-in-bundles.ts`); the enabled / disabled axis stays enforced at scan-time by the fresh resolver. Drop-in user plugins still respect boot-time filtering at the registry level — their modules weren't imported and aren't reachable mid-session (the `startsAsDisabled` exception below).
- **Bulk endpoint `PATCH /api/plugins`.** Body `{ "changes": [{ id, enabled }, ...] }`. Validates the entire batch up-front (404 / 400 / 403 with `error.details.id` pointing at the offending entry); applies in one SQLite transaction with one grouped contributions purge. The per-id `PATCH /api/plugins/:id` and qualified-id sibling stay available for CLI / external automation.
- **Buffered Settings modal.** Toggles mutate an in-memory `pendingState` only; rows show a dirty dot, a "N unsaved changes" banner appears above the list, and the footer exposes `[Discard] [Apply]` plus an italic warning when the dirty set re-enables a `startsAsDisabled` plugin. Closing the modal with pending edits opens a confirm dialog (`Discard` / `Keep editing` / `Apply`). Apply ships the bulk PATCH and triggers a scan via the new shared `ScanTriggerService`. A successful apply emits the panel's `applied` output, which the modal host translates into `visibleChange(false)` so the dialog closes once the work is done; a failed apply keeps the modal open with the error visible.

**`startsAsDisabled` wire flag.** `GET /api/plugins` rows now carry `startsAsDisabled?: boolean` for drop-in plugins whose discovery-time `status === 'disabled'`. The SPA renders a per-row hint when the user re-enables such a row, since those plugins' handlers were never loaded into memory at boot and re-engaging needs an `sm serve` restart. Built-ins always omit the flag (their handlers are statically known).

**Spec changes** (`@skill-map/spec` minor):

- `spec/cli-contract.md` § `GET /api/plugins` — adds `startsAsDisabled?: boolean` to the item shape.
- `spec/cli-contract.md` § `PATCH /api/plugins/:id` and the qualified-id sibling — "Restart required" is gone; replaced by an "Apply window" sentence documenting the per-scan-fresh-resolver behaviour and the `startsAsDisabled` exception.
- `spec/cli-contract.md` § Endpoints — new `PATCH /api/plugins` row documenting the bulk endpoint (body, error mapping, transactional semantics).
- `spec/cli-contract.md` § Error code sources — `not-found` / `bad-query` / `locked` rows updated to mention the bulk endpoint's `error.details.id` payload.
- `spec/cli-contract.md` § `kindRegistry` envelope field — clarifies that built-in Providers are listed unconditionally regardless of boot-time enabled state, and adds a parallel `contributionsRegistry` envelope-field section with the same discipline.

**Implementation** (`@skill-map/cli` minor):

- `src/core/runtime/fresh-resolver.ts` — **NEW**. Shared `buildFreshResolver` + `composeResolver` helpers used by `routes/plugins.ts`, `routes/scan.ts`, and `core/watcher/runtime.ts`.
- `src/core/runtime/plugin-runtime.ts` — `composeScanExtensions`, `composeFormatters`, `registerEnabledExtensions` accept `resolveEnabled?`; user-plugin extensions, manifests, annotation contributions, and view contributions are filtered by the resolver.
- `src/core/runtime/scan-runner.ts` — `IScanRunOpts.resolveEnabledOverride?` threaded into the compose call.
- `src/server/routes/scan.ts` — builds the fresh resolver per `POST` / `?fresh=1`.
- `src/server/routes/plugins.ts` — new `PATCH /api/plugins` bulk handler with `validateBulkChange` + `persistBulkAndProject`; `IPluginListItem` gains `startsAsDisabled`; `applyChangeToAdapter` shared between single-id and bulk paths.
- `src/server/index.ts` — `assembleBootBundle` seeds the `kindRegistry` from every built-in Provider (new `collectBuiltInProviders` helper) and `mergeBuiltInViewContributions` now walks `builtInBundles` directly instead of the composed scan extension set, so both registries cover the full built-in surface regardless of boot-time enabled state.
- `src/core/watcher/runtime.ts` — fresh resolver built per chokidar batch.
- `ui/src/app/services/scan-trigger.ts` — **NEW**. Owns the manual-scan trigger (in-flight signal, `dataSource.runScan()` + `loader.load()`). Consumed by `App` and `SettingsPlugins`.
- `ui/src/services/data-source/{port,rest-data-source,static-data-source}.ts` — new `applyPluginChanges(changes)` method.
- `ui/src/app/components/settings-modal/settings-plugins.ts/.html/.css` — buffered state (`originalState` / `pendingState`), dirty markers, `[Discard] [Apply]` footer, per-row + footer italic `startsAsDisabled` hints, removal of the persistent "Restart required" banner, `applied` output for parent-driven close. Two-zone layout (`.settings-plugins__scroll` + footer outside the scroll container) so the footer doesn't expose scroll-through gaps.
- `ui/src/app/components/settings-modal/settings-modal.ts/.html` — intercepts dialog close; opens `<p-confirmDialog>` with three actions when pending edits exist; bridges the panel's `applied` event to `visibleChange(false)` so footer Apply also closes.

**Tests**:

- `src/test/server-endpoints.test.ts` — new bulk PATCH suite (happy path, partial-failure, lock, body shape errors, `db-missing`) + a regression test asserting that `POST /api/scan` no longer re-populates a freshly-disabled plugin's contributions.

## User-facing

Plugin toggles in Settings now stage edits in the modal — click Apply (or confirm at close) to commit and refresh the graph; X discards. Changes apply on the next scan, no `sm serve` restart needed (except plugins disabled at boot, marked per-row).
