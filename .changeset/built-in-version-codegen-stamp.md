---
"@skill-map/cli": minor
"@skill-map/spec": patch
---

Decouple built-in extensions from per-extension semver. Built-ins ship inside the CLI bundle, so authors no longer declare a `version` literal in each `<plugin>/<kind>s/<name>/index.ts` manifest under `src/plugins/`. The codegen at `scripts/generate-built-ins.js` now reads the CLI version from `src/package.json` and stamps it onto every built-in (alongside the existing `pluginId` stamp) when emitting `src/plugins/built-ins.ts`. The resulting runtime objects still satisfy the full kind interface (`IAnalyzer`, `IExtractor`, ...) and every downstream consumer continues to see `ext.version: string`, so `state_executions.extension_version` keeps recording a meaningful value (= CLI version) for reproducibility.

New kernel type `IBuiltInManifest<T extends IExtensionBase> = Omit<T, 'version'>` exported from `kernel/extensions/index.js`. Built-in manifest authors type their export as `IBuiltInManifest<I<Kind>>` and omit `version`; the codegen does the rest. The 34 built-in extensions across the 5 first-party bundles (`core`, `claude`, `antigravity`, `openai`, `agent-skills`) were migrated in-tree, removing 32 cargo-cult `'1.0.0'` literals and the 2 `'0.0.0'` "stub" sentinels.

External (user-authored) plugins are unaffected: the AJV check at load time still requires `version` on every extension manifest per `spec/schemas/extensions/base.schema.json#/required`. The schema's `required` list is unchanged; only the `version` field description was updated to document the built-in / external asymmetry.

Two kernel API signatures widen from `IProvider` to `IBuiltInManifest<IProvider>` so test files that import raw built-in manifests directly (bypassing the codegen) keep type-checking without a runtime workaround. The widened functions are `resolveProviderWalk` and `buildProviderFrontmatterValidator` (plus the `IProviderFrontmatterValidator.validate` method shape); both only read `id` / `kinds` / `walk` / `read` / `schemas` and never touch `version`, so the widening is structurally safe and production callers passing fully-loaded `IProvider` values continue to type-check (subtype-passes-supertype).

The AGENTS.md "stub extensions ship as `version: '0.0.0'`" convention is retired (the chip it surfaced was hidden from the UI / CLI in the previous release). If we later want a visible placeholder signal we'll add a dedicated `stability: 'stub'` field instead of overloading `version`.
