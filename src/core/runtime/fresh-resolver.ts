/**
 * Build a `resolveEnabled` closure that reflects the current state of
 * the layered config (`settings.json#/plugins` over installed defaults).
 *
 * Enable is a pure-config concern now (the DB no longer carries it, it
 * carries the orthogonal import-trust grant), so this is a thin wrapper
 * over `makeEnabledResolver`. The "freshness" the consumers below need
 * comes from `configService.reload()` after a settings write, NOT from a
 * per-call SQLite read.
 *
 * Consumers:
 *
 *   - `src/server/routes/plugins.ts`, `GET /api/plugins` so the modal
 *     sees the post-PATCH state on F5 / re-open even though the runtime
 *     itself is boot-cached.
 *   - `src/server/routes/plugins.ts`, `PATCH /api/plugins[/...]` to
 *     project the post-write state into the response envelope (after a
 *     `configService.reload()`).
 *   - `src/server/routes/scan.ts`, `POST /api/scan` (the topbar
 *     refresh) so a manual refresh after a toggle honours the new
 *     value without restarting `sm serve`.
 *   - `src/core/watcher/runtime.ts`, per chokidar batch, so
 *     edit-driven scans honour toggles made in the same session.
 *
 * The `startsAsDisabled` exception (drop-in plugins whose discovery-time
 * `status === 'disabled'`) is enforced at compose time in
 * `plugin-runtime.ts:composeScanExtensions`, those plugins never had
 * their handlers bucketed, so the fresh resolver may say `true` for
 * them but the runtime still has nothing to invoke. The spec carries
 * this exception explicitly in `cli-contract.md §PATCH /api/plugins`.
 */

import type { IEffectiveConfig } from '../../kernel/config/loader.js';
import { makeEnabledResolver } from '../../kernel/config/plugin-resolver.js';

export interface IFreshResolverDeps {
  /**
   * Effective config provider. The BFF passes its cached
   * `configService.effective` bound method; offline callers (`runScanForCommand`,
   * the watcher's batch loop) pass a closure over their already-loaded config.
   */
  effectiveConfig: () => Pick<IEffectiveConfig, 'plugins'>;
}

/**
 * Build a resolver from the current layered config. Async-shaped so the
 * BFF / watcher call sites that previously awaited a SQLite read keep
 * the same `await` ergonomics; the implementation no longer touches the
 * DB.
 */
export async function buildFreshResolver(
  deps: IFreshResolverDeps,
): Promise<(id: string) => boolean> {
  return makeEnabledResolver(deps.effectiveConfig());
}

/**
 * Build a resolver from an already-loaded effective config. Used by
 * `PATCH /api/plugins[/...]` right after the write + `configService.reload()`
 * to project the post-write enable state into the response envelope
 * without re-reading the config.
 */
export function composeResolver(
  effectiveConfig: Pick<IEffectiveConfig, 'plugins'>,
): (id: string) => boolean {
  return makeEnabledResolver(effectiveConfig);
}
