/**
 * Shared helpers across the `sm plugins …` verb family.
 *
 * Originally inline in `cli/commands/plugins.ts`; extracted as part of
 * the architect-audit follow-up that split the verb into per-command
 * files under `cli/commands/plugins/`. Anything two or more subcommand
 * files need lives here:
 *
 *   - search-path resolution (`resolveSearchPaths`) for `<cwd>/.skill-map/plugins/`
 *     (with `--plugin-dir <path>` override)
 *   - enabled-state resolver composition (`buildResolver`), DB overrides
 *     stacked on top of `settings.json` + installed defaults
 *   - discovery (`loadAll`), runs the full PluginLoader pass
 *   - synthetic built-in bundle view (`builtInRows`) so list / show /
 *     doctor / toggle treat built-ins as first-class plugins
 *   - JSON helpers (`omitModule`) for `--json` output that includes
 *     `ILoadedExtension.module` (live ESM namespaces with cycles)
 *   - prose helpers (`wrapText`) shared by list and doctor renderers
 *
 * Per `spec/cli-contract.md` §Scope is always project-local, plugin
 * discovery walks `<cwd>/.skill-map/plugins/` only; the user-scoped
 * `~/.skill-map/plugins/` root and the `-g/--global` switch have been
 * removed. Authors that want to point at a sibling tree pass
 * `--plugin-dir <path>`.
 */

import {
  builtInBundles,
  type TBuiltInExtension,
} from '../../../plugins/built-ins.js';
import {
  createPluginLoader,
  installedSpecVersion,
  type IPluginLoaderOptions,
} from '../../../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../../../kernel/adapters/schema-validators.js';
import { loadConfig } from '../../../kernel/config/loader.js';
import { makeEnabledResolver } from '../../../kernel/config/plugin-resolver.js';
import { qualifiedExtensionId } from '../../../kernel/registry.js';
import type {
  IDiscoveredPlugin,
  TGranularity,
} from '../../../kernel/types/plugin.js';
import {
  defaultProjectPluginsDir,
  resolveDbPath,
} from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../util/runtime-context.js';
import { tryWithSqlite } from '../../util/with-sqlite.js';
import { resolve } from 'node:path';

export interface IPluginDirOption {
  pluginDir: string | undefined;
}

/**
 * Compose the search-path list every subcommand walks for plugins.
 * `--plugin-dir <path>` replaces the project default; otherwise the
 * single discovery root is `<cwd>/.skill-map/plugins/`.
 */
export function resolveSearchPaths(opts: IPluginDirOption, cwd: string): string[] {
  if (opts.pluginDir) return [resolve(opts.pluginDir)];
  return [defaultProjectPluginsDir({ cwd })];
}

/**
 * Build a resolver from the layered config (settings.json) + the DB
 * overrides (config_plugins). Either layer may be absent (no
 * settings.json, no DB), both fall through gracefully.
 */
export async function buildResolver(): Promise<(id: string) => boolean> {
  const ctx = defaultRuntimeContext();
  const { effective: cfg } = loadConfig({ cwd: ctx.cwd });
  const dbPath = resolveDbPath({ db: undefined, cwd: ctx.cwd });
  const dbOverrides =
    (await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      (adapter) => adapter.pluginConfig.loadOverrideMap(),
    )) ?? new Map<string, boolean>();
  return makeEnabledResolver(cfg, dbOverrides);
}

/**
 * Run the full PluginLoader discovery + load pass against the search
 * paths derived from `opts`. Used by every verb that needs the live
 * status of user plugins (`list` / `show` / `doctor` / `toggle`).
 */
export async function loadAll(opts: IPluginDirOption): Promise<IDiscoveredPlugin[]> {
  const ctx = defaultRuntimeContext();
  const validators = loadSchemaValidators();
  const loaderOpts: IPluginLoaderOptions = {
    searchPaths: resolveSearchPaths(opts, ctx.cwd),
    validators,
    specVersion: installedSpecVersion(),
    resolveEnabled: await buildResolver(),
  };
  const loader = createPluginLoader(loaderOpts);
  return loader.discoverAndLoadAll();
}

// --- built-in bundle synthesis -------------------------------------------

export interface IBuiltInBundleRow {
  id: string;
  granularity: TGranularity;
  enabled: boolean;
  /**
   * One- to three-sentence summary of what the bundle ships. Carried so
   * `sm plugins show <bundle>` can surface the same description the BFF
   * publishes for the SPA without re-deriving it. Always populated for
   * built-ins (the bundle declaration in `built-ins.ts` requires it).
   */
  description: string;
  extensions: ReadonlyArray<{
    id: string;
    kind: string;
    version: string;
    enabled: boolean;
    /**
     * Per-extension metadata used by the single-extension detail view
     * (`sm plugins show <bundle>/<ext>`). `description` is required by
     * the new manifest contract; `entry` is the runtime entry path
     * preserved for diagnostics.
     */
    description: string;
    entry?: string;
  }>;
  /** Per-extension version+kind catalogue, used by `sm plugins show`. */
  manifestSummary: string;
}

/**
 * Build a synthesised view over the built-in bundles with the
 * resolved enabled-state for the bundle (granularity=bundle) or each
 * extension (granularity=extension). Lets list / show / doctor /
 * toggle treat built-ins as first-class plugins.
 */
export function builtInRows(resolveEnabled: (id: string) => boolean): IBuiltInBundleRow[] {
  return builtInBundles.map((bundle) => {
    const bundleEnabled = resolveEnabled(bundle.id);
    const extensions = bundle.extensions.map((ext) => extensionRowFromBuiltIn(ext, bundle, bundleEnabled, resolveEnabled));
    const manifestSummary = bundle.extensions
      .map((ext) => `${ext.kind}:${qualifiedExtensionId(bundle.id, ext.id)}@${ext.version}`)
      .join(', ');
    return {
      id: bundle.id,
      granularity: bundle.granularity,
      enabled: bundleEnabled,
      description: bundle.description,
      extensions,
      manifestSummary,
    };
  });
}

/**
 * Build one row of `IBuiltInBundleRow.extensions`. Pulls the optional
 * metadata (`description`, `stability`, `preconditions`, `entry`) from
 * the live built-in instance so `sm plugins show <bundle>/<ext>` can
 * render a full single-extension detail without re-fetching the source
 * module. The optional fields stay `undefined` when the extension does
 * not declare them; the renderer skips empty rows.
 */
function extensionRowFromBuiltIn(
  ext: TBuiltInExtension,
  bundle: { id: string; granularity: TGranularity },
  bundleEnabled: boolean,
  resolveEnabled: (id: string) => boolean,
): IBuiltInBundleRow['extensions'][number] {
  // `exactOptionalPropertyTypes` rejects assigning `undefined` to an
  // optional field, so we build the row in two steps: required fields
  // first, then spread the optional ones only when the source defined
  // them.
  const row: IBuiltInBundleRow['extensions'][number] = {
    id: ext.id,
    kind: ext.kind,
    version: ext.version,
    enabled:
      bundle.granularity === 'bundle'
        ? bundleEnabled
        : resolveEnabled(qualifiedExtensionId(bundle.id, ext.id)),
    description: ext.description ?? '',
  };
  if (ext.entry !== undefined) row.entry = ext.entry;
  return row;
}

/**
 * JSON-serializer replacer: the `ILoadedExtension.module` field is a
 * live ESM namespace with circular references, omit it from output.
 *
 * We identify the namespace by `[Symbol.toStringTag] === 'Module'` (the
 * standard tag Node sets on ESM module records), so a plugin manifest
 * that legitimately ships an unrelated `module` key is preserved.
 */
export function omitModule(key: string, value: unknown): unknown {
  if (key !== 'module') return value;
  if (value === null || typeof value !== 'object') return value;
  const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
  return tag === 'Module' ? undefined : value;
}

/**
 * Generic greedy word-wrap to a soft visible width. Splits on
 * whitespace runs and never breaks mid-word. Returns raw lines (no
 * indent, no color); the caller prepends indent and applies styling
 * so wrap math stays honest under color codes.
 */
export function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length > maxWidth && current !== '') {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}
