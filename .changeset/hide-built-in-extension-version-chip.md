---
"@skill-map/cli": patch
---

Suppress the per-extension version chip for built-in plugins in both the UI Settings → Plugins panel and the CLI `sm plugins show` human output. Built-ins ship inside the CLI bundle and inherit the CLI version, so a per-extension semver chip on every row is noise; per-extension semver only carries meaning for external (user-authored) plugins, which keep showing it.

**UI (`ui/src/app/components/settings-modal/settings-plugins.html`)**: both `__row-version` (bundle row) and `__subrow-version` (per-extension row) are now gated on `@if (plugin.source === 'project' …)`, so they render exclusively for external plugins.

**CLI (`src/cli/commands/plugins/show.ts`)**: `IExtensionListItem.version` and `IExtensionFieldInput.version` flip to optional. `renderBuiltInDetail` and `renderBuiltInExtensionDetail` omit `version` when building items / meta for built-ins. `renderExtensionItems` drops the name-column padding when no item carries a version, so built-in rows don't trail in spaces. `renderExtensionFields` only pushes the `Version` field when meta carries one.

**i18n (`src/cli/i18n/plugins.texts.ts`)**: `detailExtensionRowGlyph` now interpolates `{{versionSuffix}}` instead of the hard-coded `  v{{version}}`. The suffix is composed per-row (either `  v<x.y.z>` for user plugins or empty for built-ins), keeping a single template for both shapes.

**Tests (`src/cli/commands/plugins/__tests__/plugins-cli.spec.ts`)**: the existing assertion that `Version 1.0.0` appears in `sm plugins show core/node-superseded` flips to `assert.doesNotMatch(r.stdout, /^\s*Version\s/m)` since the field is now intentionally absent for built-ins. The JSON contract (`--json`) is untouched and still carries `version`; a separate test in the same file already pins that.

## User-facing

**Cleaner Plugins view.** Settings → Plugins and `sm plugins show <bundle>` no longer print a per-extension version chip for built-in plugins (they all share the CLI version). External (user-authored) plugins are unchanged and still show per-extension semver.
