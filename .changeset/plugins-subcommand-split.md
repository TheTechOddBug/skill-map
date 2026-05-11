---
"@skill-map/cli": patch
---

Architect-audit follow-up: split `cli/commands/plugins.ts` (1700 LOC, 7 `eslint-disable complexity`, 7 subcommands) into per-verb modules under `cli/commands/plugins/`.

- **`cli/commands/plugins.ts`** is now a 66-LOC barrel that re-exports every command class plus `PLUGIN_COMMANDS`. Importers (`cli/entry.ts`, `test/elapsed-invariant.test.ts`) keep working unchanged.
- **`cli/commands/plugins/shared.ts`** — cross-verb helpers (`resolveSearchPaths`, `buildResolver`, `loadAll`, `builtInRows`, `omitModule`, `wrapText`, `IScopeOptions`, `IBuiltInBundleRow`).
- **`cli/commands/plugins/list.ts`** — `PluginsListCommand` + render helpers.
- **`cli/commands/plugins/show.ts`** — `PluginsShowCommand`; `resolveShowLookupId` split into `parseQualifiedId` + `collectKnownExtensions` + three error builders; `renderPluginDetail` split into `renderPluginDetailHeader` + `renderPluginDetailFields` + `collectPluginExtensionItems`.
- **`cli/commands/plugins/doctor.ts`** — `PluginsDoctorCommand` with `run()` split into 5 render methods (`#renderSummaryHeader`, `#renderSourceBreakdown`, `#renderStatusBreakdown`, `#renderWarnings`, `#renderIssues`) plus `#emitWarningEntry`; `forEachProviderInstance` and `collectApplicableKindWarnings` each split into a built-in pass + a user-plugin pass.
- **`cli/commands/plugins/toggle.ts`** — `TogglePluginsBase` with `toggle()` split into 5 phases (`#validateArgs`, `#pickTargets`, `#applyLockGate`, `#persistTargets`, `#renderSuccess`); `resolveToggleTarget` split into `resolveQualifiedToggle` + `resolveBareToggle`.
- **`cli/commands/plugins/create.ts`** — `PluginsCreateCommand` + scaffolder stubs.
- **`cli/commands/plugins/slots.ts`** — `PluginsSlotsListCommand`.
- **`cli/commands/plugins/slots-catalog.ts`** — `VIEW_SLOTS_CATALOG` / `INPUT_TYPES_CATALOG` constants (reusable by future verbs).
- **`cli/commands/plugins/upgrade.ts`** — `PluginsUpgradeCommand`.

**Eslint complexity disables: 7 → 0.** Every function that previously needed the override decomposes into smaller helpers; the lint cap is now satisfied structurally.

No behaviour change. The 36 existing tests (`plugins-cli.test.ts`, `plugins-doctor.test.ts`, `plugins-show-cli.test.ts`, `elapsed-invariant.test.ts`) pass unchanged.
