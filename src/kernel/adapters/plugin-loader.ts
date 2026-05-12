/**
 * Barrel, preserves the legacy `./plugin-loader.js` import path.
 *
 * The loader was split into a directory of cohesive modules:
 *
 *   - `./plugin-loader/index.ts`          , `PluginLoader` class,
 *                                            `createPluginLoader` factory,
 *                                            `installedSpecVersion`,
 *                                            `DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS`,
 *                                            `IPluginLoaderOptions`.
 *   - `./plugin-loader/id-utils.ts`       , id / path / type-guard
 *                                            helpers + cross-root
 *                                            id-collision pass.
 *   - `./plugin-loader/import-helpers.ts` , timeout-bounded dynamic
 *                                            import, default-export
 *                                            extraction, AJV-friendly
 *                                            export-shape stripping.
 *   - `./plugin-loader/validation.ts`     , per-extension hook trigger
 *                                            + annotation contribution
 *                                            validation (spec § A.11 /
 *                                            § 9.6.6).
 *   - `./plugin-loader/storage-schemas.ts`, spec § A.12 storage schema
 *                                            read + AJV compile.
 *
 * Importers continue to depend on `'./plugin-loader.js'`; the barrel
 * re-exports every public symbol unchanged.
 */

export {
  PluginLoader,
  createPluginLoader,
  installedSpecVersion,
  DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS,
  type IPluginLoaderOptions,
} from './plugin-loader/index.js';
