/**
 * `GET /api/activity/summary`, execution-stats snapshot for client
 * hydration (see `spec/provider-activity.md` §Execution stats):
 * connect, reconnect, live-activity re-enable. Loopback-gated like
 * every `/api/*` route; NO serve.json token (operator UI surface, like
 * the install-management routes, not the bridge's ingest path).
 *
 * Stats-only by design: the summary carries no live claim or spawn
 * state (late joiners rebuild lighting and edges from the WS stream).
 * Clients treat both this snapshot and the WS `stats` field as
 * overwrites from the single server-side source of truth, never
 * accumulating counts themselves.
 */

import type { Hono } from 'hono';

import type { ActivityStatsService } from '../activity-stats.js';

export interface IActivitySummaryRouteDeps {
  /** Boot-scoped stats accumulator (composition-root owned). */
  stats: ActivityStatsService;
}

export function registerActivitySummaryRoute(
  app: Hono,
  deps: IActivitySummaryRouteDeps,
): void {
  app.get('/api/activity/summary', (c) => {
    return c.json({ since: deps.stats.sinceMs, nodes: deps.stats.snapshot() });
  });
}
