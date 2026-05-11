/**
 * Shared helpers across the `sm plugins …` verb family.
 *
 * Originally inline in `cli/commands/plugins.ts`; extracted as part of
 * the architect-audit follow-up that split the verb into per-command
 * files under `cli/commands/plugins/`. Anything two or more subcommand
 * files need lives here:
 *
 *   - search-path resolution (`resolveSearchPaths`) for `<scope>/.skill-map/plugins/`
 *   - enabled-state resolver composition (`buildResolver`) — DB overrides
 *     stacked on top of `settings.json` + installed defaults
 *   - discovery (`loadAll`) — runs the full PluginLoader pass
 *   - synthetic built-in bundle view (`builtInRows`) so list / show /
 *     doctor / toggle treat built-ins as first-class plugins
 *   - JSON helpers (`omitModule`) for `--json` output that includes
 *     `ILoadedExtension.module` (live ESM namespaces with cycles)
 *   - prose helpers (`wrapText`) shared by list and doctor renderers
 */

import { builtInBundles } from '../../../built-in-plugins/built-ins.js';
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
  defaultUserPluginsDir,
  resolveDbPath,
} from '../../util/db-path.js';
import { defaultRuntimeContext } from '../../util/runtime-context.js';
import { tryWithSqlite } from '../../util/with-sqlite.js';
import { resolve } from 'node:path';

export interface IScopeOptions {
  global: boolean;
  pluginDir: string | undefined;
}

/**
 * Compose the search-path list every subcommand walks for plugins.
 * `--plugin-dir <path>` takes precedence and replaces both defaults;
 * otherwise `--global` narrows to the user-scoped dir, and the default
 * is `[project, user]` so a project plugin wins on id collision.
 */
export function resolveSearchPaths(opts: IScopeOptions, cwd: string, homedir: string): string[] {
  if (opts.pluginDir) return [resolve(opts.pluginDir)];
  const ctx = { cwd, homedir };
  const project = defaultProjectPluginsDir(ctx);
  const user = defaultUserPluginsDir(ctx);
  return opts.global ? [user] : [project, user];
}

/**
 * Build a resolver from the layered config (settings.json) + the DB
 * overrides (config_plugins). Either layer may be absent (no
 * settings.json, no DB) — both fall through gracefully.
 */
export async function buildResolver(global: boolean): Promise<(id: string) => boolean> {
  const ctx = defaultRuntimeContext();
  const { effective: cfg } = loadConfig({
    scope: global ? 'global' : 'project',
    cwd: ctx.cwd,
    homedir: ctx.homedir,
  });
  const dbPath = resolveDbPath({ global, db: undefined, cwd: ctx.cwd, homedir: ctx.homedir });
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
export async function loadAll(opts: IScopeOptions): Promise<IDiscoveredPlugin[]> {
  const ctx = defaultRuntimeContext();
  const validators = loadSchemaValidators();
  const loaderOpts: IPluginLoaderOptions = {
    searchPaths: resolveSearchPaths(opts, ctx.cwd, ctx.homedir),
    validators,
    specVersion: installedSpecVersion(),
    resolveEnabled: await buildResolver(opts.global),
  };
  const loader = createPluginLoader(loaderOpts);
  return loader.discoverAndLoadAll();
}

// --- built-in bundle synthesis -------------------------------------------

export interface IBuiltInBundleRow {
  id: string;
  granularity: TGranularity;
  enabled: boolean;
  extensions: ReadonlyArray<{
    id: string;
    kind: string;
    version: string;
    enabled: boolean;
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
    const extensions = bundle.extensions.map((ext) => ({
      id: ext.id,
      kind: ext.kind,
      version: ext.version,
      enabled:
        bundle.granularity === 'bundle'
          ? bundleEnabled
          : resolveEnabled(qualifiedExtensionId(bundle.id, ext.id)),
    }));
    const manifestSummary = bundle.extensions
      .map((ext) => `${ext.kind}:${qualifiedExtensionId(bundle.id, ext.id)}@${ext.version}`)
      .join(', ');
    return {
      id: bundle.id,
      granularity: bundle.granularity,
      enabled: bundleEnabled,
      extensions,
      manifestSummary,
    };
  });
}

/**
 * JSON-serializer replacer: the `ILoadedExtension.module` field is a
 * live ESM namespace with circular references — omit it from output.
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
