/**
 * `GET /api/links?kind=&from=&to=` — filtered list of persisted links.
 *
 * Reads `loadScanResult().links`, then drops rows that don't match the
 * URL filters:
 *
 *   - `kind=invokes,references` — comma-separated whitelist matched against
 *     `link.kind`. Unknown values yield zero matches (no validation against
 *     the spec enum here — `parseExportQuery`-style permissiveness so a
 *     plugin extending the link kind catalog doesn't need a server edit).
 *   - `from=<node.path>` — exact match on `link.source`.
 *   - `to=<node.path>` — exact match on `link.target`.
 *
 * No pagination — typical scopes have at most a few hundred links; the
 * brief explicitly defers paging to 14.5 if it becomes a problem.
 */

import type { Hono } from 'hono';

import type { Link } from '../../kernel/index.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { buildListEnvelope } from '../envelope.js';
import { parseCsv } from '../util/parse-query.js';
import type { IRouteDeps } from './deps.js';

export function registerLinksRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/links', async (c) => {
    const kindFilter = parseCsv(c.req.query('kind'));
    const from = c.req.query('from') ?? null;
    const to = c.req.query('to') ?? null;

    const loaded = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => adapter.scans.load(),
    );
    const allLinks: Link[] = loaded?.links ?? [];
    const filtered = allLinks.filter((link) => {
      if (kindFilter.length > 0 && !kindFilter.includes(link.kind)) return false;
      if (from !== null && link.source !== from) return false;
      if (to !== null && link.target !== to) return false;
      return true;
    });

    return c.json(
      buildListEnvelope({
        kind: 'links',
        items: filtered,
        filters: {
          kind: kindFilter.length > 0 ? kindFilter : null,
          from,
          to,
        },
        total: filtered.length,
        kindRegistry: deps.kindRegistry,
      }),
    );
  });
}
