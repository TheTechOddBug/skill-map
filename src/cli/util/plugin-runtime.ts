/**
 * Re-export shim, the plugin runtime loader was moved to
 * `core/runtime/plugin-runtime.ts` so the BFF can consume it without
 * crossing the CLI boundary. Historic CLI imports (and the
 * `test/plugin-runtime*.test.ts` suites that reach in for `formatWarning`)
 * keep working verbatim through this file.
 */

export {
  composeFormatters,
  composeScanExtensions,
  emptyPluginRuntime,
  filterBuiltInManifests,
  formatWarning,
  isBuiltInExtensionEnabled,
  loadPluginRuntime,
  registerEnabledExtensions,
  type ILoadPluginRuntimeOptions,
  type IPluginRuntimeBundle,
} from '../../core/runtime/plugin-runtime.js';
