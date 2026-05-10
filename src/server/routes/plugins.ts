/**
 * Plugins routes.
 *
 *   GET   /api/plugins                                              — list (read-only)
 *   PATCH /api/plugins/:id                                          — toggle bundle
 *   PATCH /api/plugins/:bundleId/extensions/:extensionId            — toggle extension
 *
 * Read side: same shape as before, plus `granularity` and an optional
 * `extensions[]` block when granularity === 'extension'. The UI uses
 * the latter to render expandable per-extension toggles for `core`.
 *
 * Write side: persists to `config_plugins` via `IConfigPluginsPort.set`
 * — same path the CLI's `sm plugins enable / disable` uses. The loaded
 * plugin runtime is boot-cached; the new value applies on the next
 * `sm scan` or `sm serve` restart. Spec: cli-contract.md §`PATCH
 * /api/plugins/:id`.
 *
 * Item shape (per spec/cli-contract.md §Endpoints):
 *
 *   ```ts
 *   {
 *     id: string;
 *     version: string | null;
 *     kinds: string[];
 *     status: 'enabled' | 'disabled' | 'incompatible-spec' | 'invalid-manifest' | 'load-error' | 'id-collision';
 *     reason: string | null;
 *     source: 'built-in' | 'project' | 'global';
 *     granularity: 'bundle' | 'extension';
 *     extensions?: Array<{ id, kind, version, enabled }>;  // present only when granularity === 'extension'
 *   }
 *   ```
 */

import type { Context, Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { builtInBundles, type IBuiltInBundle } from '../../built-in-plugins/built-ins.js';
import { defaultProjectPluginsDir } from '../../core/paths/db-path.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { isPluginLocked } from '../../kernel/config/locked-plugins.js';
import { makeEnabledResolver } from '../../kernel/config/plugin-resolver.js';
import type { IDiscoveredPlugin, TGranularity } from '../../kernel/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { tx } from '../../kernel/util/tx.js';
import { buildListEnvelope } from '../envelope.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import type { IRouteDeps } from './deps.js';

export interface IPluginExtensionItem {
  id: string;
  kind: string;
  version: string;
  enabled: boolean;
  /** Per-extension manifest description (`IExtensionBase.description`).
   *  Surfaced in the SPA and used as a substring-search target. */
  description?: string;
  /** Host-enforced lock (mirrors `src/server/locked-plugins.ts`). When
   *  true, the SPA renders the toggle disabled with a "locked" tag and
   *  the PATCH route returns 403 `locked`. Omitted when false to keep
   *  the wire shape lean for the common case. */
  locked?: boolean;
}

export interface IPluginListItem {
  id: string;
  version: string | null;
  kinds: string[];
  status: IDiscoveredPlugin['status'];
  reason: string | null;
  source: 'built-in' | 'project' | 'global';
  granularity: TGranularity;
  /** Bundle-level description. Built-ins: `IBuiltInBundle.description`.
   *  Drop-ins: `plugin.json#/description`. Surfaced + searchable in
   *  the SPA. Absent only for malformed user manifests that loaded as
   *  `invalid-manifest`. */
  description?: string;
  extensions?: IPluginExtensionItem[];
  /** Host-enforced lock at the bundle level (see `IPluginExtensionItem.locked`). */
  locked?: boolean;
}

interface IPatchBody {
  enabled: boolean;
}

/**
 * Discriminated handle on a toggle-able plugin (built-in bundle OR
 * discovered drop-in). Centralises the "look up by id, branch on shape"
 * pattern the PATCH routes need so the granularity / extension-existence
 * checks stay symmetrical.
 */
type TPluginHandle =
  | { kind: 'built-in'; bundle: IBuiltInBundle }
  | { kind: 'discovered'; plugin: IDiscoveredPlugin };

export function registerPluginsRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/plugins', async (c) => {
    // Build the resolver fresh on every GET so a `PATCH` from the same
    // session (or from `sm plugins enable/disable` running side-by-side)
    // surfaces immediately. The boot-cached `deps.pluginRuntime.resolveEnabled`
    // is good enough for the *runtime* path (the next scan still uses
    // it — that is the documented "restart required" caveat) but
    // emphatically NOT for the read-side projection: the modal would
    // show stale state on F5 / re-open even though the DB is correct.
    const resolveEnabled = await buildFreshResolver(deps);
    const items = listItems(deps, resolveEnabled);
    return c.json(
      buildListEnvelope({
        kind: 'plugins',
        items,
        filters: {},
        total: items.length,
        kindRegistry: deps.kindRegistry,
        contributionsRegistry: deps.contributionsRegistry,
      }),
    );
  });

  // PATCH /api/plugins/:id — bundle-level toggle. Rejects qualified ids
  // (anything containing `/`) up front so the operator hits the
  // dedicated qualified route instead of silently writing a key that
  // would never resolve.
  app.patch('/api/plugins/:id', async (c) => {
    const id = c.req.param('id');
    if (id.includes('/')) {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.pluginsGranularityExtensionExpected, { id }),
      });
    }
    const handle = findHandle(id, deps);
    if (!handle) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.pluginsUnknown, { id }),
      });
    }
    if (granularityOf(handle) !== 'bundle') {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.pluginsGranularityExtensionExpected, { id }),
      });
    }
    if (isPluginLocked(id)) {
      throw new HTTPException(403, {
        message: tx(SERVER_TEXTS.pluginsLocked, { id }),
      });
    }
    const body = await parsePatchBody(c.req.raw);
    return await persistAndProject(c, deps, id, body.enabled);
  });

  // PATCH /api/plugins/:bundleId/extensions/:extensionId — qualified-id
  // toggle for granularity=extension bundles (today: `core` plus any
  // user plugin that opts in).
  app.patch('/api/plugins/:bundleId/extensions/:extensionId', async (c) => {
    const bundleId = c.req.param('bundleId');
    const extensionId = c.req.param('extensionId');
    const handle = findHandle(bundleId, deps);
    if (!handle) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.pluginsUnknown, { id: bundleId }),
      });
    }
    if (granularityOf(handle) !== 'extension') {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.pluginsGranularityBundleExpected, { id: bundleId }),
      });
    }
    if (!hasExtension(handle, extensionId)) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.pluginsExtensionUnknown, { bundleId, extensionId }),
      });
    }
    const qualified = qualifiedExtensionId(bundleId, extensionId);
    if (isPluginLocked(qualified) || isPluginLocked(bundleId)) {
      throw new HTTPException(403, {
        message: tx(SERVER_TEXTS.pluginsExtensionLocked, { bundleId, extensionId }),
      });
    }
    const body = await parsePatchBody(c.req.raw);
    return await persistAndProject(c, deps, qualified, body.enabled);
  });
}

// --- read side ------------------------------------------------------------

/**
 * Compose the list response — built-in bundles first (in their canonical
 * order from `built-ins.ts`), then drop-ins (in discovery order). Both
 * sources share the same row shape; `granularity` + `extensions` come
 * from the bundle / manifest declaration. The `resolveEnabled` argument
 * is the resolver to use for status projection — typically the cached
 * `deps.pluginRuntime.resolveEnabled`, but PATCH passes a fresh resolver
 * built from the post-write override map.
 */
function listItems(
  deps: IRouteDeps,
  resolveEnabled: (id: string) => boolean,
): IPluginListItem[] {
  return [
    ...(deps.options.noBuiltIns ? [] : buildBuiltInItems(resolveEnabled)),
    ...buildDiscoveredItems(deps.pluginRuntime.discovered, deps, resolveEnabled),
  ];
}

function buildBuiltInItems(
  resolveEnabled: (id: string) => boolean,
): IPluginListItem[] {
  return builtInBundles.map((bundle) => {
    const bundleEnabled = resolveEnabled(bundle.id);
    const bundleLocked = isPluginLocked(bundle.id);
    const extensions: IPluginExtensionItem[] | undefined =
      bundle.granularity === 'extension'
        ? bundle.extensions.map((ext) => {
            const qualified = qualifiedExtensionId(bundle.id, ext.id);
            const extLocked = bundleLocked || isPluginLocked(qualified);
            return {
              id: ext.id,
              kind: ext.kind,
              version: ext.version,
              enabled: resolveEnabled(qualified),
              ...(ext.description ? { description: ext.description } : {}),
              ...(extLocked ? { locked: true } : {}),
            };
          })
        : undefined;
    return {
      id: bundle.id,
      version: firstVersion(bundle.extensions),
      kinds: uniqueKinds(bundle.extensions.map((e) => e.kind)),
      status: bundleEnabled ? 'enabled' : 'disabled',
      reason: null,
      source: 'built-in' as const,
      granularity: bundle.granularity,
      description: bundle.description,
      ...(extensions ? { extensions } : {}),
      ...(bundleLocked ? { locked: true } : {}),
    };
  });
}

function buildDiscoveredItems(
  discovered: IDiscoveredPlugin[],
  deps: IRouteDeps,
  resolveEnabled: (id: string) => boolean,
): IPluginListItem[] {
  return discovered.map((plugin) => buildDiscoveredItem(plugin, deps, resolveEnabled));
}

function buildDiscoveredItem(
  plugin: IDiscoveredPlugin,
  deps: IRouteDeps,
  resolveEnabled: (id: string) => boolean,
): IPluginListItem {
  const granularity: TGranularity = plugin.granularity ?? 'bundle';
  const bundleLocked = isPluginLocked(plugin.id);
  const extensions = projectExtensionRows(plugin, granularity, resolveEnabled, bundleLocked);
  const optional = optionalDiscoveredFields(plugin, extensions);
  return {
    id: plugin.id,
    version: plugin.manifest?.version ?? null,
    kinds: uniqueKinds(plugin.extensions?.map((e) => e.kind) ?? []),
    status: projectStatus(plugin, resolveEnabled),
    reason: plugin.reason ?? null,
    source: classifyPluginSource(plugin.path, deps),
    granularity,
    ...optional,
    ...(bundleLocked ? { locked: true } : {}),
  };
}

/**
 * Collect the optional fields (`description`, `extensions`) that only
 * appear when the underlying source has a value. Pulled out of
 * `buildDiscoveredItem` to keep its cyclomatic complexity within the
 * project's lint cap — every `?? null` and `&& ...` in the row literal
 * counts.
 */
function optionalDiscoveredFields(
  plugin: IDiscoveredPlugin,
  extensions: IPluginExtensionItem[] | undefined,
): Partial<Pick<IPluginListItem, 'description' | 'extensions'>> {
  const out: Partial<Pick<IPluginListItem, 'description' | 'extensions'>> = {};
  const description = plugin.manifest?.description;
  if (description) out.description = description;
  if (extensions) out.extensions = extensions;
  return out;
}

function projectExtensionRows(
  plugin: IDiscoveredPlugin,
  granularity: TGranularity,
  resolveEnabled: (id: string) => boolean,
  bundleLocked: boolean,
): IPluginExtensionItem[] | undefined {
  if (granularity !== 'extension' || !plugin.extensions) return undefined;
  return plugin.extensions.map((ext) => {
    const description = readInstanceDescription(ext.instance);
    const qualified = qualifiedExtensionId(plugin.id, ext.id);
    const extLocked = bundleLocked || isPluginLocked(qualified);
    return {
      id: ext.id,
      kind: ext.kind,
      version: ext.version,
      enabled: resolveEnabled(qualified),
      ...(description ? { description } : {}),
      ...(extLocked ? { locked: true } : {}),
    };
  });
}

/**
 * Read `description` from a loaded extension's runtime `instance` (the
 * cloned manifest the loader stored). Loosely typed: the loader stamps
 * the field as `unknown`, so we shape-check before reading. Returns
 * `undefined` when the instance is not an object or the field is
 * missing / non-string — matching the behaviour we'd get if the field
 * were absent from the manifest.
 */
function readInstanceDescription(instance: unknown): string | undefined {
  if (instance === null || typeof instance !== 'object') return undefined;
  const candidate = (instance as { description?: unknown }).description;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

/**
 * Project the plugin's resolved status under a (possibly fresh)
 * resolver. Load-failure modes (`incompatible-spec`, `invalid-manifest`,
 * `load-error`, `id-collision`) are sticky — toggling the override does
 * not unbreak a broken plugin until the next loader pass. Successful
 * loads (`enabled` / `disabled`) flip with the resolver so the PATCH
 * response reflects the post-write state honestly.
 */
function projectStatus(
  plugin: IDiscoveredPlugin,
  resolveEnabled: (id: string) => boolean,
): IDiscoveredPlugin['status'] {
  if (plugin.status !== 'enabled' && plugin.status !== 'disabled') {
    return plugin.status;
  }
  return resolveEnabled(plugin.id) ? 'enabled' : 'disabled';
}

function uniqueKinds(kinds: string[]): string[] {
  return [...new Set(kinds)].sort();
}

function firstVersion(
  extensions: ReadonlyArray<{ version?: string }>,
): string | null {
  for (const ext of extensions) {
    if (ext.version) return ext.version;
  }
  return null;
}

function classifyPluginSource(
  pluginPath: string,
  deps: IRouteDeps,
): 'project' | 'global' {
  const projectDir = defaultProjectPluginsDir(deps.runtimeContext);
  return pluginPath.startsWith(projectDir) ? 'project' : 'global';
}

// --- write side -----------------------------------------------------------

async function parsePatchBody(req: Request): Promise<IPatchBody> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HTTPException(400, { message: SERVER_TEXTS.pluginsBodyNotJson });
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HTTPException(400, { message: SERVER_TEXTS.pluginsBodyNotObject });
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj['enabled'] !== 'boolean') {
    throw new HTTPException(400, { message: SERVER_TEXTS.pluginsEnabledRequired });
  }
  return { enabled: obj['enabled'] };
}

/**
 * Persist the override and project the post-write list. Returns the
 * full list envelope so the UI can replace its state in one shot — the
 * single-plugin PATCH could return one row, but the cached resolver
 * across the rest of the table doesn't change, so the wire shape stays
 * symmetric with `GET /api/plugins`.
 *
 * DB absence ⇒ `db-missing` envelope at status 500. Read-side routes
 * degrade to empty shapes; mutations cannot persist without a DB so
 * they fail fast (per spec/cli-contract.md §Error code sources).
 */
async function persistAndProject(
  c: Context,
  deps: IRouteDeps,
  configKey: string,
  enabled: boolean,
): Promise<Response> {
  const overrides = await tryWithSqlite(
    { databasePath: deps.options.dbPath, autoBackup: false },
    async (adapter) => {
      await adapter.pluginConfig.set(configKey, enabled);
      // On disable, purge persisted contributions immediately so the
      // UI stops rendering the plugin's chips before the next scan.
      // Mirrors the CLI's `sm plugins disable` purge path (see
      // `src/cli/commands/plugins.ts` → `TogglePluginsBase.toggle`).
      // `configKey` is either a bare bundle id (`claude`) or a
      // qualified `<bundle>/<ext>` (`core/slash`); the split mirrors
      // how `scan_contributions` rows are grouped.
      if (!enabled) {
        const slash = configKey.indexOf('/');
        if (slash < 0) {
          await adapter.contributions.purgeByPlugin(configKey);
        } else {
          await adapter.contributions.purgeByPlugin(
            configKey.slice(0, slash),
            configKey.slice(slash + 1),
          );
        }
      }
      return await adapter.pluginConfig.loadOverrideMap();
    },
  );
  if (overrides === null) {
    return c.json(
      {
        ok: false as const,
        error: {
          code: 'db-missing' as const,
          message: tx(SERVER_TEXTS.pluginsDbMissing, { path: deps.options.dbPath }),
          details: null,
        },
      },
      500,
    );
  }
  const freshResolver = composeResolver(deps, overrides);
  const items = listItems(deps, freshResolver);
  return c.json(
    buildListEnvelope({
      kind: 'plugins',
      items,
      filters: {},
      total: items.length,
      kindRegistry: deps.kindRegistry,
      contributionsRegistry: deps.contributionsRegistry,
    }),
  );
}

/**
 * Build a resolver that reflects the current DB + settings.json state.
 * Read-side helper for `GET /api/plugins`; the PATCH path reuses
 * `composeResolver` after its own write. When the DB file is absent we
 * fall back to the boot-cached resolver — read paths must degrade
 * gracefully (mutations fail fast with `db-missing` instead).
 */
async function buildFreshResolver(deps: IRouteDeps): Promise<(id: string) => boolean> {
  const overrides = await tryWithSqlite(
    { databasePath: deps.options.dbPath, autoBackup: false },
    async (adapter) => adapter.pluginConfig.loadOverrideMap(),
  );
  if (overrides === null) return deps.pluginRuntime.resolveEnabled;
  return composeResolver(deps, overrides);
}

function composeResolver(
  deps: IRouteDeps,
  overrides: Map<string, boolean>,
): (id: string) => boolean {
  const { effective: cfg } = loadConfig({
    scope: deps.options.scope,
    cwd: deps.runtimeContext.cwd,
    homedir: deps.runtimeContext.homedir,
  });
  return makeEnabledResolver(cfg, overrides);
}

// --- handle helpers -------------------------------------------------------

function findHandle(id: string, deps: IRouteDeps): TPluginHandle | null {
  const builtIn = builtInBundles.find((b) => b.id === id);
  if (builtIn) return { kind: 'built-in', bundle: builtIn };
  const discovered = deps.pluginRuntime.discovered.find((p) => p.id === id);
  if (discovered) return { kind: 'discovered', plugin: discovered };
  return null;
}

function granularityOf(handle: TPluginHandle): TGranularity {
  return handle.kind === 'built-in'
    ? handle.bundle.granularity
    : (handle.plugin.granularity ?? 'bundle');
}

function hasExtension(handle: TPluginHandle, extensionId: string): boolean {
  if (handle.kind === 'built-in') {
    return handle.bundle.extensions.some((e) => e.id === extensionId);
  }
  return (handle.plugin.extensions ?? []).some((e) => e.id === extensionId);
}
