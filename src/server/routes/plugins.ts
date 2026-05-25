/**
 * Plugins routes.
 *
 *   GET   /api/plugins                                             , list (read-only)
 *   PATCH /api/plugins/:id                                         , toggle bundle
 *   PATCH /api/plugins/:bundleId/extensions/:extensionId           , toggle extension
 *
 * Read side: rows carry `granularity` (CLI-only contract: drives
 * `sm plugins enable/disable <bare-id>` validation and `--all` scope)
 * and `extensions[]` whenever the bundle declares any. The UI renders
 * expandable per-extension toggles for every bundle, regardless of
 * granularity, so the operator can disable a single extractor inside
 * the `claude` bundle without dropping the whole bundle.
 *
 * Write side: persists to `config_plugins` via `IConfigPluginsPort.set`
 * same path the CLI's `sm plugins enable / disable` uses. The loaded
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
 *     source: 'built-in' | 'project';
 *     granularity: 'bundle' | 'extension';
 *     extensions?: Array<{ id, kind, version, enabled }>;  // present whenever the bundle declares any
 *   }
 *   ```
 */

import type { Context, Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { builtInBundles, type IBuiltInBundle } from '../../plugins/built-ins.js';
import { sortBundlesForPresentation } from '../../plugins/presentation-order.js';
import { defaultProjectPluginsDir } from '../../core/paths/db-path.js';
import {
  buildFreshResolver as buildFreshResolverFromDb,
  composeResolver as composeResolverFromOverrides,
} from '../../core/runtime/fresh-resolver.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { isPluginLocked } from '../../kernel/config/locked-plugins.js';
import type { IDiscoveredPlugin, TGranularity } from '../../kernel/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { tx } from '../../kernel/util/tx.js';
import { BulkValidationError, DbMissingError } from '../app.js';
import { buildListEnvelope } from '../envelope.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
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
  source: 'built-in' | 'project';
  granularity: TGranularity;
  /** Bundle-level description. Built-ins: `IBuiltInBundle.description`.
   *  Drop-ins: `plugin.json#/description`. Surfaced + searchable in
   *  the SPA. Absent only for malformed user manifests that loaded as
   *  `invalid-manifest`. */
  description?: string;
  extensions?: IPluginExtensionItem[];
  /** Host-enforced lock at the bundle level (see `IPluginExtensionItem.locked`). */
  locked?: boolean;
  /**
   * Stamped `true` on drop-in plugins whose discovery-time `status` was
   * `'disabled'`, that is, the user had them disabled in
   * `config_plugins` / `settings.json` at `sm serve` boot, so their
   * handlers were never bucketed into the runtime. Re-enabling them via
   * PATCH persists the override but requires `sm serve` restart for
   * the handlers to be loaded; the rest of the toggle pipeline applies
   * live. The SPA renders a per-row hint when this flag is set AND the
   * user is currently re-enabling the row in the buffered modal state.
   * Built-ins always omit the flag (their handlers are statically
   * known and always loadable). Omitted when false to keep the wire
   * shape lean for the common case.
   */
  startsAsDisabled?: boolean;
}

interface IBulkChange {
  id: string;
  enabled: boolean;
}

interface IPatchBody {
  enabled: boolean;
}

interface IBulkPatchBody {
  changes: readonly IBulkChange[];
}

const SINGLE_PATCH_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['enabled'],
  properties: {
    enabled: { type: 'boolean' },
  },
} as const;

const parsePatchBody = makeBodyValidator<IPatchBody>(SINGLE_PATCH_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.pluginsBodyNotJson,
  notObject: SERVER_TEXTS.pluginsBodyNotObject,
  invalid: SERVER_TEXTS.pluginsEnabledRequired,
  mapping: {
    ':required:enabled': SERVER_TEXTS.pluginsEnabledRequired,
    '/enabled:required': SERVER_TEXTS.pluginsEnabledRequired,
    '/enabled:type:boolean': SERVER_TEXTS.pluginsEnabledRequired,
  },
});

const BULK_PATCH_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['changes'],
  properties: {
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'enabled'],
        properties: {
          id: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' },
        },
      },
    },
  },
} as const;

const parseBulkPatchBody = makeBodyValidator<IBulkPatchBody>(BULK_PATCH_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.pluginsBodyNotJson,
  notObject: SERVER_TEXTS.pluginsBodyNotObject,
  invalid: SERVER_TEXTS.pluginsChangeMalformed,
  mapping: {
    '/changes:required': SERVER_TEXTS.pluginsChangesRequired,
    '/changes:type:array': SERVER_TEXTS.pluginsChangesRequired,
  },
});

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
    // surfaces immediately. The runtime side now also picks up fresh
    // overrides on every `POST /api/scan` and watcher batch (via
    // `core/runtime/fresh-resolver.ts`), so the "next scan honours the
    // toggle" contract holds without restarting `sm serve`. Only
    // plugins that started disabled at boot still need a restart to
    // re-engage, the read row carries `startsAsDisabled: true` so the
    // SPA can surface a per-row hint for that case.
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

  // PATCH /api/plugins/:id, bundle-level toggle. Rejects qualified ids
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

  // PATCH /api/plugins/:bundleId/extensions/:extensionId, qualified-id
  // toggle for any bundle's extension. Phase 4b follow-up: this route
  // now accepts BOTH granularity=extension bundles AND
  // granularity=bundle bundles, the Settings UI exposes per-extension
  // toggles regardless. The bare-id PATCH below still enforces the
  // granularity gate so CLI / external automation keeps the bundle
  // contract (`sm plugins disable claude` rejects `claude/at-directive`
  // if claude is bundle granularity).
  app.patch('/api/plugins/:bundleId/extensions/:extensionId', async (c) => {
    const bundleId = c.req.param('bundleId');
    const extensionId = c.req.param('extensionId');
    const handle = findHandle(bundleId, deps);
    if (!handle) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.pluginsUnknown, { id: bundleId }),
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

  // PATCH /api/plugins, bulk toggle. Validates the entire batch BEFORE
  // writing (all-or-nothing); applies in one SQLite transaction with
  // one grouped contributions purge per disabled plugin. The SPA's
  // buffered Settings modal posts the final delta here so a multi-row
  // edit lands atomically and a Discard never touches the DB.
  //
  // Per-id PATCH endpoints above stay available for CLI / external
  // automation; the bulk variant exists so the SPA can stage edits.
  app.patch('/api/plugins', async (c) => {
    const { changes } = await parseBulkPatchBody(c.req.raw);
    // Validate every entry before writing, surfaces 404 / 400 / 403
    // with `error.details.id` set to the offending id so the SPA can
    // pinpoint the row that broke the batch. `BulkValidationError`
    // carries the offending id; `app.onError` formats it (audit m6).
    for (const change of changes) {
      const failure = validateBulkChange(change, deps);
      if (failure !== null) {
        throw new BulkValidationError({
          status: failure.status,
          code: failure.code,
          message: failure.message,
          id: change.id,
        });
      }
    }
    return await persistBulkAndProject(c, deps, changes);
  });
}

// --- read side ------------------------------------------------------------

/**
 * Compose the list response, built-in bundles first (in their canonical
 * order from `built-ins.ts`), then drop-ins (in discovery order). Both
 * sources share the same row shape; `granularity` + `extensions` come
 * from the bundle / manifest declaration. The `resolveEnabled` argument
 * is the resolver to use for status projection, typically the cached
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
  // Presentation order: `core` first, then vendor bundles. Mirrors
  // `sm plugins list` and the SPA's `PINNED_BUNDLE_ORDER`. Runtime
  // iteration of `builtInBundles` keeps `core` last so `core/markdown`
  // stays the terminal provider; the wire shape inverts that for the
  // UI's benefit (the SPA can sort or pin on top of this baseline).
  return sortBundlesForPresentation(builtInBundles).map((bundle) => {
    const bundleEnabled = resolveEnabled(bundle.id);
    const bundleLocked = isPluginLocked(bundle.id);
    // Phase 4b follow-up: `extensions[]` is emitted for ANY granularity
    // (was previously only `'extension'`). The Settings UI lets the
    // operator toggle individual extensions even inside a bundle so
    // the granularity field stays a CLI-only contract (controls
    // `sm plugins enable/disable <bare-id>` validation and `--all`
    // scope) while the UI offers richer per-extension control.
    const extensions: IPluginExtensionItem[] = bundle.extensions.map((ext) => {
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
    });
    return {
      id: bundle.id,
      version: firstVersion(bundle.extensions),
      kinds: uniqueKinds(bundle.extensions.map((e) => e.kind)),
      status: bundleEnabled ? 'enabled' : 'disabled',
      reason: null,
      source: 'built-in' as const,
      granularity: bundle.granularity,
      description: bundle.description,
      ...(extensions.length > 0 ? { extensions } : {}),
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

// Row builder, the cyclomatic count is the per-field optional fan-out
// (locked, startsAsDisabled, description, extensions). Splitting them
// scatters the row literal without making the projection clearer.
// eslint-disable-next-line complexity
function buildDiscoveredItem(
  plugin: IDiscoveredPlugin,
  deps: IRouteDeps,
  resolveEnabled: (id: string) => boolean,
): IPluginListItem {
  const granularity: TGranularity = plugin.granularity ?? 'bundle';
  const bundleLocked = isPluginLocked(plugin.id);
  const extensions = projectExtensionRows(plugin, granularity, resolveEnabled, bundleLocked);
  const optional = optionalDiscoveredFields(plugin, extensions);
  // `startsAsDisabled` snapshots the BOOT-time loader verdict, NOT the
  // current resolver projection. A plugin can be `status === 'disabled'`
  // here for two unrelated reasons: (a) the user disabled it in
  // `settings.json` / `config_plugins` AT BOOT, which is the case we
  // surface to the SPA so it can warn that re-enabling needs a restart;
  // or (b) the user toggled it off mid-session and the fresh resolver
  // now projects `disabled`. The latter is NOT a restart case, the
  // handlers are still in memory and re-enabling will hot-apply. The
  // `discovered.status` field carries the boot-time value (the loader
  // never mutates it), so reading it here gives us (a) without (b).
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
    ...(plugin.status === 'disabled' ? { startsAsDisabled: true } : {}),
  };
}

/**
 * Collect the optional fields (`description`, `extensions`) that only
 * appear when the underlying source has a value. Pulled out of
 * `buildDiscoveredItem` to keep its cyclomatic complexity within the
 * project's lint cap, every `?? null` and `&& ...` in the row literal
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
  _granularity: TGranularity,
  resolveEnabled: (id: string) => boolean,
  bundleLocked: boolean,
): IPluginExtensionItem[] | undefined {
  // Phase 4b follow-up: emit `extensions[]` regardless of granularity.
  // The Settings UI surfaces individual extension toggles even inside
  // bundle-granularity plugins; the CLI still gates `sm plugins
  // enable/disable <bare-id>` validation on granularity, so the
  // user-facing contract stays distinct from the UI affordance.
  // `_granularity` retained as a parameter to keep the signature
  // stable for any future granularity-aware projection.
  if (!plugin.extensions || plugin.extensions.length === 0) return undefined;
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
 * missing / non-string, matching the behaviour we'd get if the field
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
 * `load-error`, `id-collision`) are sticky, toggling the override does
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
  _pluginPath: string,
  _deps: IRouteDeps,
): 'project' {
  // Post-`--global` removal there is only one drop-in plugin root
  // (`<cwd>/.skill-map/plugins/`), so every non-built-in source is
  // project-scoped. The helper is kept (with a constant return) to
  // preserve the caller shape and leave room for future scopes.
  return 'project';
}

// --- write side -----------------------------------------------------------

/**
 * Persist the override and project the post-write list. Returns the
 * full list envelope so the UI can replace its state in one shot, the
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
      await applyChangeToAdapter(adapter, configKey, enabled);
      return await adapter.pluginConfig.loadOverrideMap();
    },
  );
  return projectListResponse(c, deps, overrides);
}

/**
 * Apply one change inside an open SQLite adapter. Shared between
 * `persistAndProject` (single-id PATCH) and `persistBulkAndProject`
 * (bulk PATCH): both upsert the `config_plugins` row and, on disable,
 * purge persisted contributions immediately so the UI stops rendering
 * the plugin's chips before the next scan. Mirrors the CLI's
 * `sm plugins disable` purge path (`src/cli/commands/plugins.ts` →
 * `TogglePluginsBase.toggle`).
 *
 * `configKey` is either a bare bundle id (`claude`) or a qualified
 * `<bundle>/<ext>` (`core/slash-command`); the split mirrors how
 * `scan_contributions` rows are grouped.
 */
async function applyChangeToAdapter(
  adapter: Parameters<Parameters<typeof tryWithSqlite>[1]>[0],
  configKey: string,
  enabled: boolean,
): Promise<void> {
  await adapter.pluginConfig.set(configKey, enabled);
  if (enabled) return;
  const slash = configKey.indexOf('/');
  if (slash < 0) {
    await adapter.contributions.purgeByPlugin(configKey);
    return;
  }
  await adapter.contributions.purgeByPlugin(
    configKey.slice(0, slash),
    configKey.slice(slash + 1),
  );
}

/**
 * Common tail for `persistAndProject` and `persistBulkAndProject`:
 * given the overrides map returned by the write transaction (or `null`
 * when the DB file was absent), emit either the `db-missing` envelope
 * or the projected list envelope.
 */
function projectListResponse(
  c: Context,
  deps: IRouteDeps,
  overrides: Map<string, boolean> | null,
): Response {
  if (overrides === null) {
    throw new DbMissingError(
      tx(SERVER_TEXTS.pluginsDbMissing, { path: deps.options.dbPath }),
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

// --- bulk write side ------------------------------------------------------

/**
 * Failure descriptor returned by `validateBulkChange`. `null` means the
 * entry passed validation; a populated value carries the HTTP status,
 * envelope `code`, and human message that the route emits with the
 * offending id in `details.id`. The route handler shapes the final
 * envelope so it stays out of this helper, symmetric with how the
 * single-id PATCHes throw `HTTPException` and let `app.onError` shape
 * the response.
 */
interface IBulkValidationFailure {
  status: 400 | 403 | 404;
  code: 'bad-query' | 'locked' | 'not-found';
  message: string;
}

/**
 * Validate one bulk-PATCH entry against the same rules the single-id
 * routes enforce: 404 unknown plugin (or extension), 400 granularity
 * mismatch, 403 lock. Returns `null` on success; on failure returns
 * the descriptor the route maps into the response envelope.
 */
// eslint-disable-next-line complexity
function validateBulkChange(
  change: IBulkChange,
  deps: IRouteDeps,
): IBulkValidationFailure | null {
  const slash = change.id.indexOf('/');
  if (slash < 0) {
    const handle = findHandle(change.id, deps);
    if (!handle) {
      return {
        status: 404,
        code: 'not-found',
        message: tx(SERVER_TEXTS.pluginsUnknown, { id: change.id }),
      };
    }
    if (granularityOf(handle) !== 'bundle') {
      return {
        status: 400,
        code: 'bad-query',
        message: tx(SERVER_TEXTS.pluginsGranularityExtensionExpected, { id: change.id }),
      };
    }
    if (isPluginLocked(change.id)) {
      return {
        status: 403,
        code: 'locked',
        message: tx(SERVER_TEXTS.pluginsLocked, { id: change.id }),
      };
    }
    return null;
  }
  const bundleId = change.id.slice(0, slash);
  const extensionId = change.id.slice(slash + 1);
  const handle = findHandle(bundleId, deps);
  if (!handle) {
    return {
      status: 404,
      code: 'not-found',
      message: tx(SERVER_TEXTS.pluginsUnknown, { id: bundleId }),
    };
  }
  // Phase 4b follow-up: qualified-id toggles accepted for both
  // granularity=extension AND granularity=bundle bundles, matching
  // the per-id PATCH route above. CLI granularity validation stays
  // unchanged (the bare-id PATCH still rejects qualified-form on
  // bundle granularity).
  if (!hasExtension(handle, extensionId)) {
    return {
      status: 404,
      code: 'not-found',
      message: tx(SERVER_TEXTS.pluginsExtensionUnknown, { bundleId, extensionId }),
    };
  }
  if (isPluginLocked(change.id) || isPluginLocked(bundleId)) {
    return {
      status: 403,
      code: 'locked',
      message: tx(SERVER_TEXTS.pluginsExtensionLocked, { bundleId, extensionId }),
    };
  }
  return null;
}

/**
 * Persist a validated batch in a single SQLite transaction and project
 * the post-write list. Empty `changes` is a no-op (still opens the DB
 * to confirm presence; degrades to `db-missing` if absent).
 *
 * The route validates the batch BEFORE this helper runs, so per-entry
 * 404 / 400 / 403 envelopes are emitted by the route handler with
 * `details.id` set to the offending id. This helper assumes every
 * entry already passed `validateBulkChange`.
 */
async function persistBulkAndProject(
  c: Context,
  deps: IRouteDeps,
  changes: readonly IBulkChange[],
): Promise<Response> {
  const overrides = await tryWithSqlite(
    { databasePath: deps.options.dbPath, autoBackup: false },
    async (adapter) => {
      for (const change of changes) {
        await applyChangeToAdapter(adapter, change.id, change.enabled);
      }
      return await adapter.pluginConfig.loadOverrideMap();
    },
  );
  return projectListResponse(c, deps, overrides);
}

/**
 * Read-side helper: build a resolver from a fresh `config_plugins` read.
 * Used by `GET /api/plugins` so a PATCH from the same session surfaces
 * immediately on F5 / re-open. The boot-cached `deps.pluginRuntime.resolveEnabled`
 * is the fallback when the DB file is absent (read paths degrade
 * gracefully; mutations fail fast with `db-missing` instead).
 *
 * Thin adapter over `core/runtime/fresh-resolver.ts:buildFreshResolver`
 * which is the shared implementation reused by scan routes + watcher.
 */
async function buildFreshResolver(deps: IRouteDeps): Promise<(id: string) => boolean> {
  return buildFreshResolverFromDb({
    databasePath: deps.options.dbPath,
    effectiveConfig: () => deps.configService.effective(),
    fallbackResolver: deps.pluginRuntime.resolveEnabled,
  });
}

/**
 * Write-side helper: build a resolver from an overrides map already
 * loaded inside the PATCH transaction. The cached layered-config view
 * is reused (no per-request `loadConfig` walk). Routes that mutate the
 * config invalidate the cache via `configService.reload()` so the next
 * read sees the new state.
 */
function composeResolver(
  deps: IRouteDeps,
  overrides: Map<string, boolean>,
): (id: string) => boolean {
  return composeResolverFromOverrides(deps.configService.effective(), overrides);
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
