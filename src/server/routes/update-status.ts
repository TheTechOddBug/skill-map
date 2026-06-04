/**
 * `GET /api/update-status`, read-only projection of the kernel
 * update-check cache stored under `_kernel.update-check` in
 * `config_preferences`.
 *
 * Pure read, never triggers a registry probe. The CLI's post-run
 * hook (`cli/util/update-check-banner.ts`) is the only writer; the
 * UI polls this endpoint to surface the same "update available"
 * signal in-app without re-fetching `registry.npmjs.org`.
 *
 * Response shape (`IUpdateStatusResponse`):
 *
 *   ```json
 *   {
 *     "current": "0.18.0",
 *     "latest":  "0.19.0",
 *     "isOutdated": true,
 *     "checkedAt": 1715212345678,
 *     "shownAt":   null
 *   }
 *   ```
 *
 * When the cache is empty (DB missing, never probed, malformed row):
 *
 *   ```json
 *   {
 *     "current": "0.18.0",
 *     "latest":  null,
 *     "isOutdated": false,
 *     "checkedAt": null,
 *     "shownAt":   null
 *   }
 *   ```
 *
 * Always 200, no envelope wrapping. The endpoint is non-essential
 * (UI degrades gracefully on an empty payload), so a missing DB is
 * communicated as "no cache yet" rather than a structured error.
 */

import type { Hono } from 'hono';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { isOutdated } from '../../kernel/update-check/index.js';
import { VERSION } from '../../version.js';
import type { IRouteDeps } from './deps.js';

export interface IUpdateStatusResponse {
  /** CLI version this server is running. */
  current: string;
  /** Last `latestVersion` recorded by the CLI's post-run hook, or `null`. */
  latest: string | null;
  /** True iff `latest` is set AND `latest > current`. */
  isOutdated: boolean;
  /** Epoch ms of the last successful registry probe, or `null`. */
  checkedAt: number | null;
  /** Epoch ms of the last banner emission, or `null`. */
  shownAt: number | null;
}

export function registerUpdateStatusRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/update-status', async (c) => {
    const cache = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => adapter.preferences.loadUpdateCheckCache(),
    );
    const payload: IUpdateStatusResponse =
      cache === null || cache === undefined
        ? {
            current: VERSION,
            latest: null,
            isOutdated: false,
            checkedAt: null,
            shownAt: null,
          }
        : {
            current: VERSION,
            latest: cache.latestVersion,
            isOutdated: isOutdated(VERSION, cache.latestVersion),
            checkedAt: cache.checkedAt,
            shownAt: cache.shownAt,
          };
    return c.json(payload);
  });
}
