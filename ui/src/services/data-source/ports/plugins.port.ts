/**
 * `IPluginsPort`, the plugin catalog surface: the list projection, the
 * enable / trust write axes, the buffered bulk apply, and the
 * plugin-declared annotation registry. Mirrors `/api/plugins` (+ its
 * per-id PATCH routes) and `/api/annotations/registered`.
 *
 * One of the domain ports composed into `IDataSourcePort`
 * (`../data-source.port.ts`).
 */

import type {
  IListEnvelopeApi,
  IPluginItemApi,
  IRegisteredAnnotationKeyApi,
} from '../../../models/api';

/**
 * Plugin row shape returned by `/api/plugins` (list + PATCH responses).
 * Mirrors the BFF's `IPluginListItem`. The Settings view consumes the
 * full shape; the demo data source ships a static snapshot.
 */
export type TPluginItem = IPluginItemApi;

/**
 * One entry in the bulk `PATCH /api/plugins` body. Mirrors the BFF's
 * `IBulkChange`: an `id` (a bare plugin id `claude` for the cascade
 * macro, or a qualified `<plugin>/<ext>` id `core/node-stability`) plus at
 * least one of `enabled` (toggle delta) / `settings` (per-setting value
 * patch). `settings` REQUIRES a qualified id; values are real JSON,
 * already coerced to the declared input-type by the client. A change
 * carries whichever axis actually moved, never an `{ id }`-only entry.
 */
export interface IPluginChange {
  id: string;
  enabled?: boolean;
  settings?: Record<string, unknown>;
}

export interface IPluginsPort {
  /** List of registered plugins. Mirrors `GET /api/plugins`. */
  listPlugins(): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * Toggle a granularity=`bundle` plugin's user override. Mirrors
   * `PATCH /api/plugins/:id`. Returns the projected list, same shape
   * as `listPlugins()`, so the caller can replace its state in one
   * shot. Throws `DataSourceError` on 4xx (`bad-query` / `not-found`)
   * or 5xx (`db-missing` / `internal`). Demo mode rejects with
   * `code: 'demo-readonly'`.
   *
   * Apply window: the override is honoured on the next scan (manual
   * via `runScan()` / `sm scan`, automatic via watcher batch), the
   * BFF rebuilds the resolver from `config_plugins` per batch.
   * Exception: plugins whose row carries `startsAsDisabled: true`
   * still need an `sm serve` restart to re-engage (their handlers
   * were never loaded into memory at boot).
   *
   * Kept on the port for CLI parity (`sm plugins enable / disable`)
   * and external automation; the Settings modal uses
   * `applyPluginChanges` for buffered multi-row edits.
   */
  setPluginEnabled(id: string, enabled: boolean): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * Toggle one extension under a granularity=`extension` plugin.
   * Mirrors `PATCH /api/plugins/:pluginId/extensions/:extensionId`.
   * Same response shape and error semantics as `setPluginEnabled`.
   */
  setPluginExtensionEnabled(
    pluginId: string,
    extensionId: string,
    enabled: boolean,
  ): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * Grant (`trusted: true`) or revoke (`trusted: false`) LOCAL import
   * trust for a single plugin. Mirrors `PATCH /api/plugins/:id/trust`
   * with body `{ trusted }`; `id` MUST be a bare plugin id (no slash).
   * This is the security axis, orthogonal to the enable toggles: a
   * plugin runs only when it is both enabled (config) AND trusted (this
   * write). The grant is per-machine and never travels in a commit.
   *
   * Returns the same `IListEnvelopeApi<TPluginItem>` shape as
   * `listPlugins()` reflecting the post-write `trusted` projection, so
   * the caller can replace its state in one shot. Built-ins and locked
   * ids reject with `code: 'locked'` (403); demo mode rejects with
   * `code: 'demo-readonly'`.
   *
   * Apply window: granting trust lets the plugin's code import on the
   * next scan / `sm serve` restart (handlers load on restart, like the
   * `startsAsDisabled` case); revoking reverts it to discovered-but-
   * unexecuted. Does NOT touch the enable axis.
   */
  setPluginTrusted(id: string, trusted: boolean): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * Apply a buffered batch of plugin changes atomically. Mirrors the
   * bulk `PATCH /api/plugins` endpoint. Each change carries an `id`
   * (plugin id `claude`, or qualified `<plugin>/<ext>` id
   * `core/node-stability`) plus a toggle delta (`enabled`), a per-setting
   * value patch (`settings`), or both; the BFF dispatcher branches on
   * the slash the same way the per-id PATCHes do. `settings` requires a
   * qualified id and ships only the keys that changed, as real JSON.
   *
   * All-or-nothing: a single invalid entry (unknown id, granularity
   * mismatch, lock, bad setting value) rejects the whole batch and the
   * DB is not touched. The error's `details.id` carries the offending
   * entry so the Settings modal can pinpoint the row that broke the
   * apply.
   *
   * Returns the same `IListEnvelopeApi<TPluginItem>` shape as
   * `listPlugins()` with the post-write state. Demo mode rejects with
   * `code: 'demo-readonly'`.
   */
  applyPluginChanges(
    changes: ReadonlyArray<IPluginChange>,
  ): Promise<IListEnvelopeApi<TPluginItem>>;

  /**
   * `GET /api/annotations/registered`. Returns the runtime annotation
   * contribution catalog declared by plugin manifests. Demo mode
   * returns `[]` so consumers render every namespace as "unregistered"
   *, same fallback the live path takes when the fetch fails.
   */
  getRegisteredAnnotations(): Promise<readonly IRegisteredAnnotationKeyApi[]>;
}
