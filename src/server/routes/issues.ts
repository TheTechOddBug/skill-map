/**
 * `GET /api/issues?severity=&analyzerId=&node=`, filtered list of persisted issues.
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
 * No pagination at 14.2, see the catalogue note in the brief.
 */

import type { Hono } from 'hono';

import type { Issue } from '../../kernel/index.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { matchesAnalyzerFilter } from '../../kernel/util/analyzer-filter.js';
import { buildListEnvelope } from '../envelope.js';
import { parseCsv } from '../util/parse-query.js';
import type { IRouteDeps } from './deps.js';

export function registerIssuesRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/issues', async (c) => {
    const severityFilter = parseCsv(c.req.query('severity'));
    const analyzerFilter = parseCsv(c.req.query('analyzerId'));
    const nodePath = c.req.query('node') ?? null;

    const loaded = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => adapter.issues.listAll(),
    );
    const allIssues: Issue[] = loaded ?? [];
    const filtered = allIssues.filter((issue) => {
      if (severityFilter.length > 0 && !severityFilter.includes(issue.severity)) return false;
      if (analyzerFilter.length > 0 && !matchesAnalyzerFilter(issue.analyzerId, analyzerFilter)) return false;
      if (nodePath !== null && !issue.nodeIds.includes(nodePath)) return false;
      return true;
    });

    return c.json(
      buildListEnvelope({
        kind: 'issues',
        items: filtered,
        filters: {
          severity: severityFilter.length > 0 ? severityFilter : null,
          analyzerId: analyzerFilter.length > 0 ? analyzerFilter : null,
          node: nodePath,
        },
        total: filtered.length,
        kindRegistry: deps.kindRegistry,
        contributionsRegistry: deps.contributionsRegistry,
      }),
    );
  });
}
