/**
 * `GET /api/activity/summary`, execution-stats snapshot for client
 * hydration (see `spec/provider-activity.md` §Execution stats):
 * connect, reconnect, live-activity re-enable. Loopback-gated like
 * every `/api/*` route; NO serve.json token (operator UI surface, like
 * the install-management routes, not the bridge's ingest path).
 *
 * Alongside the boot-scoped counters the response carries `runNodes`,
 * the distinct node paths holding persistent AI-run history
 * (`state_executions`): the counters reset on every server restart but
 * the DB history does not, so clients deriving Activity visibility
 * from the counters alone would hide recorded runs until fresh runtime
 * activity touches the node. A missing DB degrades to `[]`.
 *
 * Otherwise stats-only by design: the summary carries no live claim or
 * spawn state (late joiners rebuild lighting and edges from the WS
 * stream). Clients treat both this snapshot and the WS `stats` field
 * as overwrites from the single server-side source of truth, never
 * accumulating counts themselves.
 */

import type { Hono } from 'hono';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { ActivityStatsService } from '../activity-stats.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import type { IRouteDeps } from './deps.js';

export interface IActivitySummaryRouteDeps extends Pick<IRouteDeps, 'options'> {
  /** Boot-scoped stats accumulator (composition-root owned). */
  stats: ActivityStatsService;
}

export function registerActivitySummaryRoute(
  app: Hono,
  deps: IActivitySummaryRouteDeps,
): void {
  app.get('/api/activity/summary', async (c) => {
    const runNodes = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      (adapter) => adapter.history.nodesWithRuns(),
    );
    return c.json({
      since: deps.stats.sinceMs,
      nodes: deps.stats.snapshot(),
      pairs: deps.stats.pairSnapshot(),
      runNodes: runNodes ?? [],
    });
  });
}
