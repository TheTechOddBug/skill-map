/**
 * `GET /api/issues?severity=&analyzerId=&node=&nodes=&offset=&limit=`,
 * paginated and filtered list of persisted issues.
 *
 * Filters:
 *
 *   - `severity=error,warn`, comma-separated whitelist (any subset of
 *     `error|warn|info`). Unknown severities yield zero matches.
 *   - `analyzerId=core/reference-broken,core/name-collision`, comma-separated rule
 *     ids. Match shape mirrors `sm check`'s `--analyzers`: an entry without
 *     a `/` matches the suffix after `/` so a user can drop the
 *     `<plugin>/` prefix when it's unambiguous.
 *   - `node=<node.path>`, keep issues whose `nodeIds` array includes
 *     the given path.
 *   - `nodes=<path1>,<path2>`, multi-node variant of `node=`: keep
 *     issues whose `nodeIds` array intersects the given set. Used by
 *     the linked-nodes panel to fetch issues for a focused node + its
 *     neighbours in one round-trip. Empty CSV is treated as absent;
 *     when both `node` and `nodes` are set, the storage layer
 *     intersects them (AND semantics).
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
import { bffReadVersionCheck } from '../util/db-read-check.js';
import { buildListEnvelope } from '../envelope.js';
import { parseCsv, parsePagination } from '../util/parse-query.js';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../limits.js';
import type { IIssueListFilter } from '../../kernel/types/storage.js';
import type { IRouteDeps } from './deps.js';

export function registerIssuesRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/issues', async (c) => {
    const inputs = parseIssuesQuery(c.req.query());
    const result = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      (adapter) => adapter.issues.list(inputs.filter),
    );
    return c.json(
      buildListEnvelope({
        kind: 'issues',
        items: result?.items ?? [],
        filters: inputs.echo,
        total: result?.total ?? 0,
        page: { offset: inputs.filter.offset, limit: inputs.filter.limit },
        kindRegistry: deps.kindRegistry,
        providerRegistry: deps.providerRegistry,
        contributionsRegistry: deps.contributionsRegistry,
      }),
    );
  });
}

/**
 * Parse the route's query bag into the storage-layer filter shape +
 * the envelope-echo shape. Lives at module scope so the route handler
 * stays under the per-function complexity budget; the two shapes ride
 * together because both consume the same raw inputs (severity /
 * analyzerId / node / nodes / pagination).
 *
 * `nodes=` is treated as absent when omitted OR when the CSV parses
 * to an empty list; the storage layer treats an explicit empty array
 * as "match nothing", which would be surprising for a missing param.
 * Callers that want zero-match semantics should skip the call.
 */
function parseIssuesQuery(query: Record<string, string | undefined>): {
  filter: IIssueListFilter;
  echo: Record<string, unknown>;
} {
  const severityFilter = parseCsv(query['severity']);
  const analyzerFilter = parseCsv(query['analyzerId']);
  const nodePath = query['node'] ?? null;
  const nodesRaw = parseCsv(query['nodes']);
  const nodesFilter = nodesRaw.length > 0 ? nodesRaw : null;
  const { offset, limit } = parsePagination(query, {
    limit: DEFAULT_LIMIT,
    max: MAX_LIMIT,
  });
  const filter: IIssueListFilter = {
    severities: severityFilter,
    analyzerIds: analyzerFilter,
    nodePath,
    offset,
    limit,
  };
  if (nodesFilter) filter.nodePaths = nodesFilter;
  return {
    filter,
    echo: {
      severity: severityFilter.length > 0 ? severityFilter : null,
      analyzerId: analyzerFilter.length > 0 ? analyzerFilter : null,
      node: nodePath,
      nodes: nodesFilter,
    },
  };
}
