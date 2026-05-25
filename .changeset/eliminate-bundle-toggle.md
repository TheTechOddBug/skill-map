---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Eliminate the bundle-level toggle entirely. Every plugin extension is now independently toggle-able by its qualified `<bundle>/<ext>` id; the bundle itself is a presentational grouping only.

**What changed**

- **Manifest schema**: `granularity` is removed from `spec/schemas/plugins-registry.schema.json`. A user plugin manifest that still declares it is rejected as `invalid-manifest` via AJV's `additionalProperties: false`. Built-in `plugin.json` files dropped the field; the generator (`scripts/generate-built-ins.js`) no longer emits it.
- **Kernel**: `TGranularity` deleted from `src/kernel/types/plugin.ts`; `IDiscoveredPlugin.granularity` and `IPluginManifest.granularity` gone. The runtime resolver (`src/core/runtime/plugin-runtime/resolver.ts`) keys every gate on the qualified extension id.
- **CLI** (`src/cli/commands/plugins/`): the bare bundle id (`sm plugins disable claude`) is now a **macro** that fans the toggle out across every extension inside the bundle. Single-extension bundles (`openai`, `antigravity`, `agent-skills`) apply without prompting. Multi-extension bundles (`claude`, `core`, multi-extension user plugins) require `--yes` OR an interactive TTY confirm; non-TTY contexts must pass `--yes` or the verb refuses with a directed message and the list of affected extensions. `--all` cascades through every bundle's extensions under the same gate. Qualified-id form (`sm plugins disable claude/at-directive`) toggles exactly that extension with no prompt. The `--yes` / `-y` flag is added to `enable` and `disable`. Granularity-mismatch error messages (`'claude' has granularity=bundle`, `'core' has granularity=extension`) are removed; the new error path is "unknown id" / "macro requires confirmation". `sm plugins doctor` summary reverts to `N enabled extensions · …` and counts every extension independently (built-ins and loaded user plugins alike).
- **BFF** (`src/server/routes/plugins.ts`): `PATCH /api/plugins/:id` becomes the **cascade endpoint** that persists one `config_plugins` row per child extension. Granularity-mismatch rejections are gone. The qualified-id sibling (`PATCH /api/plugins/:bundleId/extensions/:extensionId`) is unchanged and remains the canonical per-extension surface. `PATCH /api/plugins` (bulk) accepts bare bundle ids and qualified ids in the same batch; bare entries cascade at write time. The `granularity` field is removed from `IPluginListItem` on the wire; the bundle row's `status` aggregates child enablement (`enabled` when ≥1 extension is enabled).
- **SPA** (`ui/src/app/components/settings-modal/`): the bundle-level `<p-toggleswitch>` is removed (`canToggleBundle()` and `onBundleToggle()` deleted); bundle rows render as labelled headers with their per-extension list underneath. The "kind filter" chip now narrows the extensions array universally (it used to leave bundle-granularity bundles unfiltered, leaking extractors / analyzers when the user clicked "provider"). `IPluginItemApi.granularity` and `TPluginGranularityApi` removed from `ui/src/models/api.ts`.
- **Spec prose**: `spec/architecture.md` §Plugin loader, `spec/cli-contract.md` §Endpoints + §Error code sources, `spec/plugin-author-guide.md` §Toggle model (replacing the old §Granularity), `spec/db-schema.md` §scan_contributions are all rewritten to reflect the per-extension toggle model and the macro form on bare ids.

**Tests + fixtures**

- Plugin-loader spec asserts the field is now rejected via `additionalProperties`.
- CLI plugins spec rewrites the granularity describe block as bundle-macro semantics (`--yes` required for multi-extension bundles, single-extension bundles apply directly, qualified-id form flips exactly that extension).
- SPA settings-plugins spec updates the helper to call `onExtensionToggle` (the bundle has no toggle method anymore) and asserts the kind filter narrows extensions.
- Conformance fixture (`spec/conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/plugin.json`) drops the field.

**Drive-by**

`sm plugins doctor` summary reverts to a plain `N enabled extensions` form (the `4 bundles + 27 extensions` breakdown shipped in `d66bc71` was meaningful when bundles had their own toggle axis; with the unified per-extension model the split is no longer informative). The new `countByStatus` walks every extension uniformly across built-ins and user plugins.

## User-facing

Plugins no longer have a bundle-level switch; each extension toggles on its own. `sm plugins disable <bundle>` cascades across the bundle's extensions (multi-extension bundles need `--yes`). The kind filter narrows extensions inside matched bundles instead of leaking siblings.
