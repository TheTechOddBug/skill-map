/**
 * `GET /api/issues?severity=&analyzerId=&node=&offset=&limit=`,
 * paginated and filtered list of persisted issues.
 *
 * Filters:
 *
 *   - `severity=error,warn`, comma-separated whitelist (any subset of
 *     `error|warn|info`). Unknown severities yield zero matches.
 *   - `analyzerId=core/broken-ref,core/superseded`, comma-separated rule
 *     ids. Match shape mirrors `sm check`'s `--analyzers`: an entry without
 *     a `/` matches the suffix after `/` so a user can drop the
 *     `<plugin>/` prefix when it's unambiguous.
 *   - `node=<node.path>`, keep issues whose `nodeIds` array includes
 *     the given path.
 *
 * **Pagination** mirrors `/api/nodes` exactly: defaults `offset=0`,
 * `limit=100`; `limit > 1000` rejects with `bad-query` via the
 * `parsePagination` helper. Audit L6 (2026-05-12) added pagination
 * and pushed the three filters into the storage layer
 * (`port.issues.list`) so the route is O(page) instead of the prior
 * O(table) full-load + JS-filter + JS-slice path.
 *
 * Response envelope grows a `counts.page` field (`{ offset, limit }`)
 * for parity with `/api/nodes`. The change is internal: the BFF is
 * loopback-only pre-v0.6.0 and only the bundled UI consumes the
 * endpoint, so this is not a user-facing wire change.
 */

import type { Hono } from 'hono';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { buildListEnvelope } from '../envelope.js';
import { parseCsv, parsePagination } from '../util/parse-query.js';
import type { IRouteDeps } from './deps.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function registerIssuesRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/issues', async (c) => {
    const severityFilter = parseCsv(c.req.query('severity'));
    const analyzerFilter = parseCsv(c.req.query('analyzerId'));
    const nodePath = c.req.query('node') ?? null;
    const { offset, limit } = parsePagination(c.req.query(), {
      limit: DEFAULT_LIMIT,
      max: MAX_LIMIT,
    });

    const result = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) =>
        adapter.issues.list({
          severities: severityFilter,
          analyzerIds: analyzerFilter,
          nodePath,
          offset,
          limit,
        }),
    );
    const items = result?.items ?? [];
    const total = result?.total ?? 0;

    return c.json(
      buildListEnvelope({
        kind: 'issues',
        items,
        filters: {
          severity: severityFilter.length > 0 ? severityFilter : null,
          analyzerId: analyzerFilter.length > 0 ? analyzerFilter : null,
          node: nodePath,
        },
        total,
        page: { offset, limit },
        kindRegistry: deps.kindRegistry,
        contributionsRegistry: deps.contributionsRegistry,
      }),
    );
  });
}
