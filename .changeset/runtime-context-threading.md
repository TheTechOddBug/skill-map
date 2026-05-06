---
"@skill-map/cli": minor
---

Step 9.6 review queue R14 — `loadPluginRuntime` now honours an explicit `runtimeContext` override. The BFF composition root (`server/index.ts:assembleBootBundle`) threads its already-resolved `runtimeContext` through to plugin discovery so a `createServer({ runtimeContext: { cwd: <tempdir>, ... } })` boot actually walks `<tempdir>/.skill-map/plugins/` instead of the real `process.cwd()`. Pre-R14 the option was silently ignored — `loadPluginRuntime` fabricated a fresh `defaultRuntimeContext()` per helper.

**API addition.** `ILoadPluginRuntimeOptions` grows an optional `runtimeContext?: IRuntimeContext` field. When present, the loader uses it for both `resolveSearchPaths` (project + user plugin dirs) and `buildEnabledResolver` (config + DB plugin overrides). When absent, behaviour is identical to today — `defaultRuntimeContext()` is used. CLI verbs that call `loadPluginRuntime({ scope })` are unchanged.

**Test cleanup.** `src/test/server-annotations-endpoint.test.ts` no longer needs the `createApp()` bypass that 9.6.6 introduced for the populated catalog. All four cases (empty, populated, envelope-schema validation, mutation guard) now boot through the real composition root against tempdir-rooted plugin fixtures planted under `<tempdir>/.skill-map/plugins/`. The fixture helper plants a single-extractor plugin per id whose `annotationContributions` map drives the catalog assertions.
