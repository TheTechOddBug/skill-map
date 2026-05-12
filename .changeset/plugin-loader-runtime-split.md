---
"@skill-map/cli": patch
---

Split two coupled kernel-side files into per-concern directories. Same shape as the earlier `kernel/orchestrator/` split.

**`kernel/adapters/plugin-loader.ts`** (991 LOC → 35 LOC barrel + 5 files under `plugin-loader/`):

```
plugin-loader.ts         35 LOC  — barrel
plugin-loader/
├── index.ts            524 LOC  — PluginLoader class + createPluginLoader +
│                                  installedSpecVersion + DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS
├── validation.ts       177 LOC  — validateAnnotationContributions +
│                                  validateHookTriggers + KNOWN_KINDS catalog
├── storage-schemas.ts  154 LOC  — loadStorageSchemas + compilePluginSchema
├── id-utils.ts         135 LOC  — fail + isInsidePlugin + describe + isRecord +
│                                  pathId + applyIdCollisions
└── import-helpers.ts    93 LOC  — importWithTimeout + extractDefault +
                                   stripFunctionsAndPluginId + stripKindsRuntimeFields
```

The `PluginLoader` class itself stays whole inside `plugin-loader/index.ts` (~400 LOC) — its private helpers stay private; the value of this split is moving the standalone validation / id / import / storage helpers into cohesive files where each is reachable on its own.

**`core/runtime/plugin-runtime.ts`** (981 LOC → 57 LOC barrel + 6 files under `plugin-runtime/`):

```
plugin-runtime.ts        57 LOC  — barrel
plugin-runtime/
├── index.ts            299 LOC  — loadPluginRuntime + IPluginRuntimeBundle +
│                                  ILoadPluginRuntimeOptions + emptyPluginRuntime +
│                                  AnnotationContributionConflictError +
│                                  enforceRootExclusivity
├── composer.ts         368 LOC  — composeScanExtensions + composeFormatters +
│                                  registerEnabledExtensions +
│                                  accumulateBuiltInScanExtensions +
│                                  IConformanceKillSwitches
├── resolver.ts         148 LOC  — buildEnabledResolver + isBuiltInExtensionEnabled +
│                                  isBundleEntryEnabled + isPluginExtensionEnabled +
│                                  buildGranularityMap + defaultResolveEnabled
├── bucketing.ts        110 LOC  — bucketLoaded + collectAnnotationContributions +
│                                  isExtensionInstance
├── warnings.ts          96 LOC  — emitWarnings + formatWarning + cap constants +
│                                  resolveRuntimeContext + resolveSearchPaths
└── catalogs.ts          76 LOC  — collectRegisteredContributionKeys +
                                   filterBuiltInManifests
```

**Compatibility.** Both barrels re-export every public symbol so the 18 existing importers (9 per file) keep working without modification.

**Eslint disables.** Counts preserved: 5 on the loader side, 5 on the runtime side, all legitimate per `context/lint.md` (validation gates, multi-fold accumulators, kind-specific dispatch). No new disables introduced.

No behaviour change. 1381/1381 tests pass.
