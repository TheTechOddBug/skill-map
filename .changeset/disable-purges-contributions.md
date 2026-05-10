---
"@skill-map/cli": patch
"@skill-map/spec": minor
---

Disabling a plugin now wipes its `scan_contributions` rows immediately, instead of waiting for the next `sm scan` to sweep them. Without the eager purge, the catalog sweep documented in `db-schema.md` § scan_contributions only ran on the next scan, so the UI kept rendering the plugin's footer / card chips even though the toggle showed `enabled: false`.

Both toggle paths converge on the same purge:

- CLI — `sm plugins disable <id>` and `sm plugins disable --all` (`TogglePluginsBase.toggle` in `src/cli/commands/plugins.ts`).
- BFF — `PATCH /api/plugins/:id` and `PATCH /api/plugins/:bundleId/extensions/:extensionId` (the UI's Settings → Plugins toggle).

Each call to `pluginConfig.set(id, false)` is followed by `adapter.contributions.purgeByPlugin(pluginId, extensionId?)`. `extensionId` is omitted for bundle-granularity ids (`claude`) and supplied for qualified ids (`core/slash`), mirroring how the catalog sweep groups rows. Re-enabling does NOT restore the rows — the next scan re-emits them, same as a cold start.

Plugin-managed state (`state_plugin_kvs`, dedicated `plugin_<id>_*` tables) is **not** touched. The asymmetry is intentional: contributions are scan-derived (cheap to recompute, must reflect the live catalog), KV / dedicated-table state is plugin-managed and must survive toggle cycles. See `spec/plugin-kv-api.md` and `spec/db-schema.md` for the contract.

**Spec changes** (`@skill-map/spec` minor — new method on `StoragePort.contributions`):

- `spec/architecture.md` § View contribution system → Persistence — catalog sweep now narrowed to "uninstalled-on-disk plugins, removed contributions"; eager-purge-on-disable documented as the primary path for disabled bundles.
- `spec/db-schema.md` § `scan_contributions` — same narrowing; new "Eager purge on disable" subsection describing `purgeByPlugin(pluginId, extensionId?)`.
- `spec/cli-contract.md` § Plugins — `sm plugins disable` row mentions the immediate purge.
- `spec/plugin-author-guide.md` § Plugin states — `disabled` row mentions the immediate purge.
- `spec/plugin-kv-api.md` § Backup and retention — clarifies the asymmetry between `scan_contributions` (purged) and KV / dedicated tables (preserved).

**Implementation** (`@skill-map/cli` patch):

- `src/kernel/adapters/sqlite/contributions.ts` — `purgeContributionsByPlugin(db, pluginId, extensionId?)` now optionally narrows by extension.
- `src/kernel/ports/storage.ts` — `StoragePort.contributions.purgeByPlugin(pluginId, extensionId?)` added to the contract.
- `src/kernel/adapters/sqlite/storage-adapter.ts` — wires the namespace method to the helper.
- `src/cli/commands/plugins.ts` — toggle base class calls the purge when `enabled === false`.
- `src/server/routes/plugins.ts` — `persistAndProject` calls the purge when `enabled === false`.
- `ui/src/app/components/settings-modal/settings-plugins.ts` — after a successful UI toggle, calls `CollectionLoaderService.load()` so the cached in-memory `node.contributions[]` is refreshed against the just-purged DB and the card chips disappear without the user pressing Refresh. The loader's existing `pendingRefresh` collapsing semantics handle back-to-back toggles cheaply.

**Tests**:

- `src/test/view-contributions.test.ts` — new unit test asserting `purgeByPlugin` narrows by `extensionId` when supplied.
- `src/test/plugins-cli.test.ts` — new end-to-end test asserting `sm plugins disable <id>` drops the plugin's `scan_contributions` rows while leaving unrelated plugin rows untouched.
- `ui/src/app/components/settings-modal/settings-plugins.spec.ts` — new test asserting the toggle handler calls `CollectionLoaderService.load()` so the card chips reflect the BFF purge. (The pre-existing `settings-plugins.spec.ts` suite is currently broken on `main` for unrelated reasons — `verifySemanticsOfNgModuleDef` Angular DI failure across 24 UI test files — but the new test is correctly written and will activate once that suite is fixed.)

## User-facing

Disabling a plugin now removes its card chips from the UI immediately. Previously the chips lingered until the next `sm scan`, making the toggle look broken.
