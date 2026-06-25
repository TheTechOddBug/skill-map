/**
 * Plugins routes.
 *
 *   GET   /api/plugins                                             , list (read-only)
 *   PATCH /api/plugins/:id                                         , bundle macro toggle
 *   PATCH /api/plugins/:pluginId/extensions/:extensionId           , single-extension toggle
 *
 * Read side: rows carry `extensions[]` whenever the plugin declares
 * any. Every extension is independently toggle-able by its qualified
 * id; the plugin is a presentational grouping and has no plugin-level
 * toggle of its own.
 *
 * Write side: persists to `config_plugins` via `IConfigPluginsPort.set`,
 * same path the CLI's `sm plugins enable / disable` uses. The loaded
 * plugin runtime is boot-cached; the new value applies on the next
 * `sm scan` or `sm serve` restart. Spec: cli-contract.md §`PATCH
 * /api/plugins/:id`.
 *
 * `PATCH /api/plugins/:id` is the **cascade endpoint**: it fans the
 * toggle out across every extension inside the plugin. Single-extension
 * plugins (`codex`, `antigravity`, `agent-skills`) flip just their
 * provider; multi-extension plugins (`claude`, `core`, user plugins)
 * flip every child. External automation calling this endpoint is
 * expected to know it's asking for a macro.
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
 *     extensions?: Array<{ id, kind, version, enabled }>;
 *   }
 *   ```
 */

import type { Context, Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { builtInPlugins, type IBuiltInPlugin } from '../../plugins/built-ins.js';
import { sortPluginsForPresentation } from '../../plugins/presentation-order.js';
import { defaultProjectPluginsDir } from '../../core/paths/db-path.js';
import {
  buildFreshResolver as buildFreshResolverFromDb,
  composeResolver as composeResolverFromOverrides,
} from '../../core/runtime/fresh-resolver.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { IContributionErrorRecord } from '../../kernel/adapters/sqlite/contributions.js';
import { isPluginLocked } from '../../kernel/config/locked-plugins.js';
import {
  installedDefaultEnabled,
  type EnabledResolver,
} from '../../kernel/config/plugin-resolver.js';
import type { TExtensionStability } from '../../kernel/extensions/index.js';
import type { TSettingDeclaration } from '../../kernel/types/view-catalog.js';
import type { IDiscoveredPlugin } from '../../kernel/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { tx } from '../../kernel/util/tx.js';
import { BulkValidationError, DbMissingError } from '../app.js';
import { buildListEnvelope } from '../envelope.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';
import {
  persistSettingsPatch,
  projectExtensionSettings,
  readManifestSettings,
  validateSettingsPatch,
  type ISettingDeclarationApi,
} from './plugins-settings.js';
import type { IEffectiveConfig } from '../../kernel/config/loader.js';

export interface IPluginExtensionItem {
  id: string;
  kind: string;
  version: string;
  enabled: boolean;
  /** Per-extension manifest description (`IExtensionBase.description`).
   *  Surfaced in the SPA and used as a substring-search target. */
  description?: string;
  /** Per-extension lifecycle label (`IExtensionBase.stability`).
   *  Carried verbatim when the manifest declares it; missing means
   *  `stable`. The SPA badges only the non-default values
   *  (`experimental` / `beta` / `deprecated`). */
  stability?: TExtensionStability;
  /** Host-enforced lock (mirrors `src/server/locked-plugins.ts`). When
   *  true, the SPA renders the toggle disabled with a "locked" tag and
   *  the PATCH route returns 403 `locked`. Omitted when false to keep
   *  the wire shape lean for the common case. */
  locked?: boolean;
  /**
   * Declared user-configurable settings for this extension, in manifest
   * order, each = the manifest declaration plus its `id` (the settingId
   * key). Omitted entirely when the extension declares no settings, so
   * the wire shape stays lean for the common case. The SPA renders one
   * control per entry from `type` + the per-type params.
   */
  settings?: ISettingDeclarationApi[];
  /**
   * Resolved EFFECTIVE values keyed by settingId (manifest default
   * overlaid by the merged config, validated). `secret`-typed settings
   * are NEVER present here, their stored-ness is signalled via
   * `secretSettingsSet`. Omitted when the extension declares no settings.
   */
  settingValues?: Record<string, unknown>;
  /**
   * settingIds of `secret`-typed settings that currently hold a stored
   * value. Lets the SPA show "set" vs "empty" without the secret value
   * crossing the wire. Listed only when a value exists; omitted when no
   * secret is set.
   */
  secretSettingsSet?: string[];
}

/**
 * One runtime contribution-rejection from the last scan, embedded per
 * plugin on the `GET /api/plugins` list item. Projected from
 * `IContributionErrorRecord` (the kernel's `scan_contribution_errors`
 * row) minus `pluginId` (it is the grouping key) and `emittedAt` (the
 * SPA panel does not surface a timestamp). The optional `contributionId`
 * / `slot` are absent for the `undeclared-contribution-ref` rejection
 * shape, present for an AJV payload failure. Wire shape only, the
 * rest-envelope schema leaves list `items` open, mirroring how
 * `extensions` / `locked` / `startsAsDisabled` stay typed-only.
 */
export interface IPluginRuntimeContributionError {
  extensionId: string;
  nodePath: string;
  reason: string;
  message: string;
  contributionId?: string;
  slot?: string;
}

export interface IPluginListItem {
  id: string;
  version: string | null;
  kinds: string[];
  status: IDiscoveredPlugin['status'];
  reason: string | null;
  source: 'built-in' | 'project';
  /** Plugin-level description. Built-ins: `IBuiltInPlugin.description`.
   *  Drop-ins: `plugin.json#/description`. Surfaced + searchable in
   *  the SPA. Absent only for malformed user manifests that loaded as
   *  `invalid-manifest`. */
  description?: string;
  extensions?: IPluginExtensionItem[];
  /** Host-enforced lock at the plugin level (see `IPluginExtensionItem.locked`). */
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
  /**
   * Runtime view-contribution rejections from the LAST scan that the
   * kernel attributed to this plugin (read from `scan_contribution_errors`
   * via `port.contributions.listAllErrors()`, grouped by `pluginId`).
   * Usually absent (a clean scan emits none); the SPA's plugin panel
   * renders the list when present. Omitted (not `[]`) when the plugin
   * has no rejections, keeping the wire shape lean for the common case.
   */
  runtimeContributionErrors?: IPluginRuntimeContributionError[];
}

interface IBulkChange {
  id: string;
  /**
   * Toggle the extension(s). Optional: a change MAY carry settings only.
   * Bare plugin ids cascade across every child (the macro); qualified
   * `<plugin>/<ext>` ids apply verbatim.
   */
  enabled?: boolean;
  /**
   * Per-setting value patch keyed by settingId. REQUIRES a qualified
   * `<plugin>/<ext>` id (a bare plugin id carrying settings is rejected).
   * Values are real JSON (no shell coercion). Secret-typed values route
   * to `settings.local.json`; others to `settings.json`.
   */
  settings?: Record<string, unknown>;
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
        // `id` is the only mandatory field; a change carries `enabled`,
        // `settings`, or both. `minProperties: 2` enforces at least one
        // of the two beyond `id` (an `{ id }`-only entry is a no-op the
        // client should not send). Per-setting type validation runs in
        // code against the manifest, so `settings` is a permissive
        // object here (the body schema only fixes its container shape).
        required: ['id'],
        minProperties: 2,
        properties: {
          id: { type: 'string', minLength: 1 },
          enabled: { type: 'boolean' },
          settings: { type: 'object' },
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
    // A change with neither `enabled` nor `settings` (just `id`) trips
    // `minProperties`; surface the same "malformed entry" message.
    '/changes/*:minProperties': SERVER_TEXTS.pluginsChangeMalformed,
    '/changes/*:type:object': SERVER_TEXTS.pluginsChangeMalformed,
    '/changes/*/settings:type:object': SERVER_TEXTS.pluginsChangeMalformed,
    '/changes/*/enabled:type:boolean': SERVER_TEXTS.pluginsChangeMalformed,
  },
});

/**
 * Discriminated handle on a toggle-able plugin (built-in plugin OR
 * discovered drop-in). Centralises the "look up by id, branch on shape"
 * pattern the PATCH routes need so the granularity / extension-existence
 * checks stay symmetrical.
 */
type TPluginHandle =
  | { kind: 'built-in'; plugin: IBuiltInPlugin }
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
    // Embed the last scan's runtime contribution-rejections per plugin
    // (read-only). The errors are read from `scan_contribution_errors`
    // via the storage port and grouped by `pluginId`; usually zero, so
    // the common case adds no field. The list is the surface the SPA
    // already fetches, so embedding here saves it a second round-trip.
    const errorsByPlugin = await loadRuntimeContributionErrors(deps);
    attachRuntimeContributionErrors(items, errorsByPlugin);
    return c.json(
      buildListEnvelope({
        kind: 'plugins',
        items,
        filters: {},
        total: items.length,
        kindRegistry: deps.kindRegistry,
        providerRegistry: deps.providerRegistry,
        contributionsRegistry: deps.contributionsRegistry,
      }),
    );
  });

  // PATCH /api/plugins/:id, bundle macro toggle. Fans the toggle out
  // across every extension inside the plugin. The plugin itself is
  // presentational; the qualified-id route is the canonical per-extension
  // path for the SPA, this route is the convenience for CLI / external
  // automation that wants to flip a whole plugin at once.
  //
  // Rejects qualified ids (anything containing `/`) up front so the
  // operator hits the qualified route instead of accidentally trying
  // to cascade via the wrong handle.
  app.patch('/api/plugins/:id', async (c) => {
    const id = c.req.param('id');
    if (id.includes('/')) {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.pluginsCascadeRouteQualifiedRejected, { id }),
      });
    }
    const handle = findHandle(id, deps);
    if (!handle) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.pluginsUnknown, { id }),
      });
    }
    if (isPluginLocked(id)) {
      throw new HTTPException(403, {
        message: tx(SERVER_TEXTS.pluginsLocked, { id }),
      });
    }
    const body = await parsePatchBody(c.req.raw);
    const childIds = pluginExtensionIds(handle).map((extId) => qualifiedExtensionId(id, extId));
    // Drop locked children silently to mirror the CLI bulk semantics
    // (`#applyLockGate` in toggle.ts), so a multi-child cascade does
    // not abort when one extension happens to be locked.
    const writable = childIds.filter((q) => !isPluginLocked(q));
    return await persistManyAndProject(c, deps, writable, body.enabled);
  });

  // PATCH /api/plugins/:pluginId/extensions/:extensionId, the canonical
  // per-extension toggle. Every extension is independently toggle-able
  // by its qualified id, so the SPA posts here for every per-row flip
  // in the Settings modal.
  app.patch('/api/plugins/:pluginId/extensions/:extensionId', async (c) => {
    const pluginId = c.req.param('pluginId');
    const extensionId = c.req.param('extensionId');
    const handle = findHandle(pluginId, deps);
    if (!handle) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.pluginsUnknown, { id: pluginId }),
      });
    }
    if (!hasExtension(handle, extensionId)) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.pluginsExtensionUnknown, { pluginId, extensionId }),
      });
    }
    const qualified = qualifiedExtensionId(pluginId, extensionId);
    if (isPluginLocked(qualified) || isPluginLocked(pluginId)) {
      throw new HTTPException(403, {
        message: tx(SERVER_TEXTS.pluginsExtensionLocked, { pluginId, extensionId }),
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
 * Compose the list response, built-in plugins first (in their canonical
 * order from `built-ins.ts`), then drop-ins (in discovery order). Both
 * sources share the same row shape; `granularity` + `extensions` come
 * from the plugin / manifest declaration. The `resolveEnabled` argument
 * is the resolver to use for status projection, typically the cached
 * `deps.pluginRuntime.resolveEnabled`, but PATCH passes a fresh resolver
 * built from the post-write override map.
 */
function listItems(
  deps: IRouteDeps,
  resolveEnabled: (id: string) => boolean,
): IPluginListItem[] {
  // Merged effective config, read once per list build so every
  // extension's `settingValues` projects off the same snapshot. Routes
  // that mutate the config call `configService.reload()` before
  // re-projecting, so this view is always current for the response.
  const config = deps.configService.effective();
  return [
    ...(deps.options.noBuiltIns ? [] : buildBuiltInItems(resolveEnabled, config)),
    ...buildDiscoveredItems(deps.pluginRuntime.discovered, deps, resolveEnabled, config),
  ];
}

function buildBuiltInItems(
  resolveEnabled: EnabledResolver,
  config: IEffectiveConfig,
): IPluginListItem[] {
  // Presentation order: `core` first, then vendor plugins. Mirrors
  // `sm plugins list` and the SPA's `PINNED_PLUGIN_ORDER`. Runtime
  // iteration of `builtInPlugins` keeps `core` last so `core/markdown`
  // stays the terminal provider; the wire shape inverts that for the
  // UI's benefit (the SPA can sort or pin on top of this baseline).
  return sortPluginsForPresentation(builtInPlugins).map((plugin) => {
    const pluginLocked = isPluginLocked(plugin.id);
    const extensions: IPluginExtensionItem[] = plugin.extensions.map((ext) => {
      const qualified = qualifiedExtensionId(plugin.id, ext.id);
      const extLocked = pluginLocked || isPluginLocked(qualified);
      // Built-in extension objects ARE the manifest, so the declared
      // `settings` map is read directly off `ext`.
      const settings = projectExtensionSettings(
        plugin.id,
        ext.id,
        readManifestSettings(ext),
        config,
      );
      return {
        id: ext.id,
        kind: ext.kind,
        version: ext.version,
        enabled: resolveEnabled(qualified, installedDefaultEnabled(ext.stability)),
        ...(ext.description ? { description: ext.description } : {}),
        ...(ext.stability ? { stability: ext.stability } : {}),
        ...(extLocked ? { locked: true } : {}),
        ...settings,
      };
    });
    // Aggregate plugin status: `enabled` when at least one extension is
    // enabled, `disabled` otherwise. The plugin has no toggle of its own,
    // this is just a row-level summary for the list view.
    const pluginEnabled = extensions.some((e) => e.enabled);
    return {
      id: plugin.id,
      version: firstVersion(plugin.extensions),
      kinds: uniqueKinds(plugin.extensions.map((e) => e.kind)),
      status: pluginEnabled ? 'enabled' : 'disabled',
      reason: null,
      source: 'built-in' as const,
      description: plugin.description,
      ...(extensions.length > 0 ? { extensions } : {}),
      ...(pluginLocked ? { locked: true } : {}),
    };
  });
}

function buildDiscoveredItems(
  discovered: IDiscoveredPlugin[],
  deps: IRouteDeps,
  resolveEnabled: (id: string) => boolean,
  config: IEffectiveConfig,
): IPluginListItem[] {
  return discovered.map((plugin) => buildDiscoveredItem(plugin, deps, resolveEnabled, config));
}

function buildDiscoveredItem(
  plugin: IDiscoveredPlugin,
  deps: IRouteDeps,
  resolveEnabled: (id: string) => boolean,
  config: IEffectiveConfig,
): IPluginListItem {
  const pluginLocked = isPluginLocked(plugin.id);
  const extensions = projectExtensionRows(plugin, resolveEnabled, pluginLocked, config);
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
    ...optional,
    ...(pluginLocked ? { locked: true } : {}),
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
  resolveEnabled: EnabledResolver,
  pluginLocked: boolean,
  config: IEffectiveConfig,
): IPluginExtensionItem[] | undefined {
  if (!plugin.extensions || plugin.extensions.length === 0) return undefined;
  return plugin.extensions.map((ext) => {
    const description = readInstanceDescription(ext.instance);
    const qualified = qualifiedExtensionId(plugin.id, ext.id);
    const extLocked = pluginLocked || isPluginLocked(qualified);
    // Discovered extensions carry the cloned manifest on `instance`; the
    // declared `settings` map is read off it the same way `description`
    // is.
    const settings = projectExtensionSettings(
      plugin.id,
      ext.id,
      readManifestSettings(ext.instance),
      config,
    );
    return {
      id: ext.id,
      kind: ext.kind,
      version: ext.version,
      enabled: resolveEnabled(qualified, installedDefaultEnabled(ext.stability)),
      ...(description ? { description } : {}),
      ...(ext.stability ? { stability: ext.stability } : {}),
      ...(extLocked ? { locked: true } : {}),
      ...settings,
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

// --- runtime contribution errors (last scan) ------------------------------

/**
 * Load the last scan's runtime contribution-rejections from
 * `scan_contribution_errors` (via the storage port) and group them by
 * `pluginId` into the per-item wire shape. Cold-start posture mirrors
 * the rest of the read routes: a missing DB file (`tryWithSqlite`
 * returns `null`) degrades to an empty map, so a fresh project with no
 * scan yet renders cleanly. The port read itself tolerates a missing
 * table (returns `[]`).
 */
async function loadRuntimeContributionErrors(
  deps: IRouteDeps,
): Promise<Map<string, IPluginRuntimeContributionError[]>> {
  try {
    const rows = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => adapter.contributions.listAllErrors(),
    );
    if (rows === null) return new Map();
    return groupContributionErrorsByPlugin(rows);
  } catch {
    // Best-effort, same posture as `sm plugins doctor`: a missing table
    // (a DB written before this feature shipped) must not 500 the whole
    // plugins list. The errors are an advisory overlay, degrade to none.
    return new Map();
  }
}

/**
 * Group raw `IContributionErrorRecord` rows by `pluginId`, projecting
 * each onto the per-item wire shape (`pluginId` dropped, it is the
 * grouping key; `emittedAt` dropped, the panel surfaces no timestamp).
 * Row order is preserved (the port already sorts by `(pluginId,
 * extensionId, nodePath, emittedAt)` ASC for a stable render).
 */
function groupContributionErrorsByPlugin(
  rows: readonly IContributionErrorRecord[],
): Map<string, IPluginRuntimeContributionError[]> {
  const out = new Map<string, IPluginRuntimeContributionError[]>();
  for (const row of rows) {
    const projected: IPluginRuntimeContributionError = {
      extensionId: row.extensionId,
      nodePath: row.nodePath,
      reason: row.reason,
      message: row.message,
      ...(row.contributionId !== undefined ? { contributionId: row.contributionId } : {}),
      ...(row.slot !== undefined ? { slot: row.slot } : {}),
    };
    const list = out.get(row.pluginId);
    if (list) list.push(projected);
    else out.set(row.pluginId, [projected]);
  }
  return out;
}

/**
 * Attach each plugin's grouped runtime contribution-errors to its list
 * item in place. Plugins with no rejections keep the field absent (not
 * `[]`) so the wire shape stays lean for the common clean-scan case.
 */
function attachRuntimeContributionErrors(
  items: IPluginListItem[],
  errorsByPlugin: ReadonlyMap<string, IPluginRuntimeContributionError[]>,
): void {
  for (const item of items) {
    const errors = errorsByPlugin.get(item.id);
    if (errors && errors.length > 0) item.runtimeContributionErrors = errors;
  }
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
 * Cascade variant of `persistAndProject`: apply the same boolean to
 * every qualified id in `keys` inside a single SQLite transaction.
 * Used by `PATCH /api/plugins/:id` to fan the macro out across the
 * plugin's children. Empty `keys` (every child happened to be locked
 * and got filtered out at the route level) still reaches here and
 * returns the unchanged list, no DB writes, no envelope error.
 */
async function persistManyAndProject(
  c: Context,
  deps: IRouteDeps,
  keys: readonly string[],
  enabled: boolean,
): Promise<Response> {
  const overrides = await tryWithSqlite(
    { databasePath: deps.options.dbPath, autoBackup: false },
    async (adapter) => {
      for (const key of keys) {
        await applyChangeToAdapter(adapter, key, enabled);
      }
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
 * `configKey` is either a bare plugin id (`claude`) or a qualified
 * `<plugin>/<ext>` (`core/slash-command`); the split mirrors how
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
      providerRegistry: deps.providerRegistry,
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
 * routes enforce: 404 unknown plugin (or extension), 403 lock. Bare
 * plugin ids in a bulk request behave as the cascade macro (same as
 * `PATCH /api/plugins/:id`), so the validator only checks plugin
 * existence and the row-level lock; the cascade itself happens in
 * `persistBulkAndProject`. Returns `null` on success; on failure
 * returns the descriptor the route maps into the response envelope.
 */
function validateBulkChange(
  change: IBulkChange,
  deps: IRouteDeps,
): IBulkValidationFailure | null {
  return change.id.includes('/')
    ? validateQualifiedBulkChange(change, deps)
    : validateBareBulkChange(change, deps);
}

/**
 * Validate a bare-plugin-id bulk change (the cascade macro). Settings
 * are per-extension, so a bare id carrying `settings` is the wrong
 * granularity and is rejected. Otherwise only plugin existence + the
 * row-level lock are checked (the cascade itself happens at write time).
 */
function validateBareBulkChange(
  change: IBulkChange,
  deps: IRouteDeps,
): IBulkValidationFailure | null {
  if (change.settings !== undefined) {
    return {
      status: 400,
      code: 'bad-query',
      message: tx(SERVER_TEXTS.pluginsSettingsRequireQualifiedId, { id: change.id }),
    };
  }
  const handle = findHandle(change.id, deps);
  if (!handle) {
    return {
      status: 404,
      code: 'not-found',
      message: tx(SERVER_TEXTS.pluginsUnknown, { id: change.id }),
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

/**
 * Validate a qualified `<plugin>/<ext>` bulk change: plugin + extension
 * existence, the lock gate, and, when present, the `settings` patch
 * (every settingId declared, every value type-checks). Done before any
 * write (all-or-nothing batch).
 */
function validateQualifiedBulkChange(
  change: IBulkChange,
  deps: IRouteDeps,
): IBulkValidationFailure | null {
  const slash = change.id.indexOf('/');
  const pluginId = change.id.slice(0, slash);
  const extensionId = change.id.slice(slash + 1);
  const handle = findHandle(pluginId, deps);
  if (!handle) {
    return {
      status: 404,
      code: 'not-found',
      message: tx(SERVER_TEXTS.pluginsUnknown, { id: pluginId }),
    };
  }
  // Phase 4b follow-up: qualified-id toggles accepted for both
  // granularity=extension AND granularity=plugin plugins, matching
  // the per-id PATCH route above. CLI granularity validation stays
  // unchanged (the bare-id PATCH still rejects qualified-form on
  // plugin granularity).
  if (!hasExtension(handle, extensionId)) {
    return {
      status: 404,
      code: 'not-found',
      message: tx(SERVER_TEXTS.pluginsExtensionUnknown, { pluginId, extensionId }),
    };
  }
  if (isPluginLocked(change.id) || isPluginLocked(pluginId)) {
    return {
      status: 403,
      code: 'locked',
      message: tx(SERVER_TEXTS.pluginsExtensionLocked, { pluginId, extensionId }),
    };
  }
  if (change.settings !== undefined) {
    return validateChangeSettings(handle, pluginId, extensionId, change.settings);
  }
  return null;
}

/**
 * Validate the `settings` patch of one qualified-id bulk change. The
 * extension must declare settings, every settingId must be declared, and
 * every value must pass its input-type's per-value rules (reusing the
 * kernel resolver via `validateSettingsPatch`). Returns `null` on
 * success, else the 400 descriptor the route maps into the bulk envelope.
 */
function validateChangeSettings(
  handle: TPluginHandle,
  pluginId: string,
  extensionId: string,
  patch: Record<string, unknown>,
): IBulkValidationFailure | null {
  const declarations = handleExtensionSettings(handle, extensionId);
  if (!declarations || Object.keys(declarations).length === 0) {
    return {
      status: 400,
      code: 'bad-query',
      message: tx(SERVER_TEXTS.pluginsSettingsNoneDeclared, { pluginId, extensionId }),
    };
  }
  const failure = validateSettingsPatch(pluginId, extensionId, declarations, patch);
  if (failure !== null) {
    return {
      status: 400,
      code: 'bad-query',
      message: tx(SERVER_TEXTS.pluginsSettingsInvalid, {
        settingId: failure.settingId,
        pluginId,
        extensionId,
        reason: failure.reason,
      }),
    };
  }
  return null;
}

/**
 * Read the declared `settings` map for one extension off a plugin
 * handle. Built-in extension objects ARE the manifest; discovered
 * extensions carry it on `instance`. Returns `undefined` when the
 * extension cannot be found or declares no settings.
 */
function handleExtensionSettings(
  handle: TPluginHandle,
  extensionId: string,
): Record<string, TSettingDeclaration> | undefined {
  if (handle.kind === 'built-in') {
    const ext = handle.plugin.extensions.find((e) => e.id === extensionId);
    return readManifestSettings(ext);
  }
  const ext = (handle.plugin.extensions ?? []).find((e) => e.id === extensionId);
  return readManifestSettings(ext?.instance);
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
  // 1. Enabled toggles land in `config_plugins` (SQLite). Only changes
  //    carrying `enabled` participate; a settings-only change skips the
  //    toggle pass entirely. Opening the DB here also confirms its
  //    presence BEFORE any settings file write, so a missing DB fails
  //    fast (db-missing) without leaving a half-applied config on disk.
  const overrides = await tryWithSqlite(
    { databasePath: deps.options.dbPath, autoBackup: false },
    async (adapter) => {
      for (const change of changes) {
        if (change.enabled === undefined) continue;
        // Bare plugin ids cascade across every child extension (same
        // semantic as the single-id `PATCH /api/plugins/:id` macro);
        // qualified `<plugin>/<ext>` ids are applied verbatim.
        const writeKeys = expandBulkChangeKeys(change, deps);
        for (const key of writeKeys) {
          await applyChangeToAdapter(adapter, key, change.enabled);
        }
      }
      return await adapter.pluginConfig.loadOverrideMap();
    },
  );
  // DB absent ⇒ fail fast before any settings write touches disk.
  if (overrides === null) {
    throw new DbMissingError(
      tx(SERVER_TEXTS.pluginsDbMissing, { path: deps.options.dbPath }),
    );
  }

  // 2. Settings writes land in settings.json / settings.local.json via
  //    `writeConfigValue` (file writes, AJV-revalidated per write).
  //    `cwd` comes from the runtime context the composition root
  //    threaded in.
  const settingsTouched = persistBulkSettings(deps, changes);

  // 3. Settings writes mutated the on-disk config; drop the cached
  //    layered view so the projection below (and any later read) sees
  //    the fresh values. Toggle writes go to SQLite, not the config
  //    layers, so they need no reload.
  if (settingsTouched) deps.configService.reload();

  return projectListResponse(c, deps, overrides);
}

/**
 * Apply every change's `settings` patch to the config files. Each value
 * routes to `settings.local.json` (secret-typed) or `settings.json`
 * (everything else) via `persistSettingsPatch`. Returns `true` when at
 * least one settings value was written, so the caller can decide whether
 * to invalidate the config cache. Assumes every patch already passed
 * `validateBulkChange` (qualified id, declared settingIds, valid values).
 *
 * A persist failure (AJV revalidation rejecting the merged file) is
 * surfaced as a `DbMissingError`-sibling 500 via `HTTPException`; the
 * batch is all-or-nothing on validation but settings writes are applied
 * sequentially, so a mid-batch failure leaves earlier writes in place.
 * In practice validation already guarantees acceptance, so this is a
 * defence-in-depth path.
 */
function persistBulkSettings(deps: IRouteDeps, changes: readonly IBulkChange[]): boolean {
  const cwd = deps.runtimeContext.cwd;
  let touched = false;
  for (const change of changes) {
    if (change.settings === undefined) continue;
    const slash = change.id.indexOf('/');
    // Validation guarantees a qualified id here; guard defensively.
    if (slash < 0) continue;
    const pluginId = change.id.slice(0, slash);
    const extensionId = change.id.slice(slash + 1);
    const handle = findHandle(pluginId, deps);
    const declarations = handle ? handleExtensionSettings(handle, extensionId) : undefined;
    try {
      persistSettingsPatch(pluginId, extensionId, declarations, change.settings, cwd);
    } catch (err) {
      throw new HTTPException(500, {
        message: tx(SERVER_TEXTS.pluginsSettingsPersistFailed, {
          id: change.id,
          message: err instanceof Error ? err.message : String(err),
        }),
      });
    }
    if (Object.keys(change.settings).length > 0) touched = true;
  }
  return touched;
}

/**
 * Expand a bulk-PATCH change into the set of qualified ids it should
 * persist. Bare plugin ids cascade into every child extension; locked
 * children are silently dropped (matches the CLI's bulk-mode lock
 * semantics). Qualified ids resolve to themselves.
 */
function expandBulkChangeKeys(change: IBulkChange, deps: IRouteDeps): string[] {
  if (change.id.includes('/')) return [change.id];
  const handle = findHandle(change.id, deps);
  if (!handle) return [];
  return pluginExtensionIds(handle)
    .map((extId) => qualifiedExtensionId(change.id, extId))
    .filter((q) => !isPluginLocked(q));
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
  const builtIn = builtInPlugins.find((b) => b.id === id);
  if (builtIn) return { kind: 'built-in', plugin: builtIn };
  const discovered = deps.pluginRuntime.discovered.find((p) => p.id === id);
  if (discovered) return { kind: 'discovered', plugin: discovered };
  return null;
}

/**
 * Enumerate every extension id inside a plugin (built-in or discovered).
 * Used by `PATCH /api/plugins/:id` to expand the bare plugin id into
 * the qualified ids the macro cascade will flip.
 */
function pluginExtensionIds(handle: TPluginHandle): string[] {
  if (handle.kind === 'built-in') {
    return handle.plugin.extensions.map((e) => e.id);
  }
  return (handle.plugin.extensions ?? []).map((e) => e.id);
}

function hasExtension(handle: TPluginHandle, extensionId: string): boolean {
  if (handle.kind === 'built-in') {
    return handle.plugin.extensions.some((e) => e.id === extensionId);
  }
  return (handle.plugin.extensions ?? []).some((e) => e.id === extensionId);
}
