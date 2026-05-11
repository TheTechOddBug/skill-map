/**
 * Build a `resolveEnabled` closure that reflects the current state of
 * `config_plugins` in the DB layered over `settings.json#/plugins`.
 *
 * Consumers:
 *
 *   - `src/server/routes/plugins.ts` — `GET /api/plugins` so the modal
 *     sees the post-PATCH state on F5 / re-open even though the bundle
 *     itself is boot-cached.
 *   - `src/server/routes/plugins.ts` — `PATCH /api/plugins[/...]` to
 *     project the post-write state into the response envelope.
 *   - `src/server/routes/scan.ts` — `POST /api/scan` (the topbar
 *     refresh) so a manual refresh after a toggle honours the new
 *     value without restarting `sm serve`.
 *   - `src/core/watcher/runtime.ts` — per chokidar batch, so
 *     edit-driven scans honour toggles made in the same session.
 *
 * One SQLite read per call (`SELECT plugin_id, enabled FROM
 * config_plugins`); the layered `IEffectiveConfig` is supplied by the
 * caller (cached via `ConfigService` in the BFF, loaded per process by
 * watcher / CLI offline callers).
 *
 * The `startsAsDisabled` exception (drop-in plugins whose discovery-time
 * `status === 'disabled'`) is enforced at compose time in
 * `plugin-runtime.ts:composeScanExtensions` — those plugins never had
 * their handlers bucketed, so the fresh resolver may say `true` for
 * them but the runtime still has nothing to invoke. The spec carries
 * this exception explicitly in `cli-contract.md §PATCH /api/plugins`.
 */

import type { IEffectiveConfig } from '../../kernel/config/loader.js';
import { makeEnabledResolver } from '../../kernel/config/plugin-resolver.js';
import { tryWithSqlite } from '../sqlite/with-sqlite.js';

export interface IFreshResolverDeps {
  /** Absolute path to the project / global SQLite DB. */
  databasePath: string;
  /**
   * Effective config provider. The BFF passes its cached
   * `configService.effective` bound method; offline callers (`runScanForCommand`,
   * the watcher's batch loop) pass a closure over their already-loaded config.
   */
  effectiveConfig: () => Pick<IEffectiveConfig, 'plugins'>;
  /**
   * Resolver to return when the DB file is absent. Read-side callers
   * degrade to the boot-cached resolver here so the request still
   * returns a usable shape; mutating callers should never hit this path
   * (the DB-missing gate runs before the write).
   */
  fallbackResolver: (id: string) => boolean;
}

/**
 * Build a resolver from a fresh `config_plugins` read.
 *
 * Returns the `fallbackResolver` when the DB file is absent (read-paths
 * degrade; mutating callers fail fast with `db-missing` upstream).
 */
export async function buildFreshResolver(
  deps: IFreshResolverDeps,
): Promise<(id: string) => boolean> {
  const overrides = await tryWithSqlite(
    { databasePath: deps.databasePath, autoBackup: false },
    async (adapter) => adapter.pluginConfig.loadOverrideMap(),
  );
  if (overrides === null) return deps.fallbackResolver;
  return makeEnabledResolver(deps.effectiveConfig(), overrides);
}

/**
 * Build a resolver from an already-loaded overrides map. Used by
 * `PATCH /api/plugins[/...]` right after the write transaction: the
 * route loads the map inside the same transaction that wrote it, then
 * composes the resolver to project the post-write state into the
 * response envelope without a second SQLite open.
 */
export function composeResolver(
  effectiveConfig: Pick<IEffectiveConfig, 'plugins'>,
  overrides: Map<string, boolean>,
): (id: string) => boolean {
  return makeEnabledResolver(effectiveConfig, overrides);
}
