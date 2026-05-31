/**
 * Barrel, preserves the legacy `./plugin-runtime.js` import path.
 *
 * The runtime loader was split into a directory of cohesive modules:
 *
 *   - `./plugin-runtime/index.ts`    , `loadPluginRuntime`,
 *                                       `emptyPluginRuntime`,
 *                                       `AnnotationContributionConflictError`,
 *                                       `IPluginRuntime`,
 *                                       `ILoadPluginRuntimeOptions`.
 *   - `./plugin-runtime/resolver.ts` , layered enabled-resolver
 *                                       (settings.json + DB) and the
 *                                       per-plugin / per-extension
 *                                       granularity helpers.
 *   - `./plugin-runtime/composer.ts` , `composeScanExtensions`,
 *                                       `composeFormatters`,
 *                                       `registerEnabledExtensions`,
 *                                       `IConformanceKillSwitches`.
 *   - `./plugin-runtime/catalogs.ts` , `collectRegisteredContributionKeys`,
 *                                       `filterBuiltInManifests`.
 *   - `./plugin-runtime/bucketing.ts`, per-kind bucketing + per-extension
 *                                       annotation contribution collection.
 *   - `./plugin-runtime/warnings.ts` , diagnostic-line renderer +
 *                                       runtime-context / search-path
 *                                       resolution.
 *
 * Importers continue to depend on `'./plugin-runtime.js'`; the barrel
 * re-exports every public symbol unchanged.
 */

export {
  loadPluginRuntime,
  emptyPluginRuntime,
  AnnotationContributionConflictError,
  type IPluginRuntime,
  type ILoadPluginRuntimeOptions,
} from './plugin-runtime/index.js';

export {
  isBuiltInExtensionEnabled,
} from './plugin-runtime/resolver.js';

export {
  composeScanExtensions,
  composeFormatters,
  registerEnabledExtensions,
  type IConformanceKillSwitches,
} from './plugin-runtime/composer.js';

export {
  collectRegisteredContributionKeys,
  filterBuiltInManifests,
} from './plugin-runtime/catalogs.js';

export {
  formatWarning,
} from './plugin-runtime/warnings.js';
