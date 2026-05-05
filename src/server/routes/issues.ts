/**
 * `GET /api/issues?severity=&ruleId=&node=` — filtered list of persisted issues.
 *
 * Filters:
 *
 *   - `severity=error,warn` — comma-separated whitelist (any subset of
 *     `error|warn|info`). Unknown severities yield zero matches.
 *   - `ruleId=core/broken-ref,core/superseded` — comma-separated rule
 *     ids. Match shape mirrors `sm check`'s `--rules`: an entry without
 *     a `/` matches the suffix after `/` so a user can drop the
 *     `<plugin>/` prefix when it's unambiguous.
 *   - `node=<node.path>` — keep issues whose `nodeIds` array includes
 *     the given path.
 *
 * No pagination at 14.2 — see the catalogue note in the brief.
 */

import type { Hono } from 'hono';

import type { Issue } from '../../kernel/index.js';
import { tryWithSqlite } from '../../cli/util/with-sqlite.js';
import { matchesRuleFilter } from '../../kernel/util/rule-filter.js';
import { buildListEnvelope } from '../envelope.js';
import { parseCsv } from '../util/parse-query.js';
import type { IRouteDeps } from './deps.js';

export function registerIssuesRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/issues', async (c) => {
    const severityFilter = parseCsv(c.req.query('severity'));
    const ruleFilter = parseCsv(c.req.query('ruleId'));
    const nodePath = c.req.query('node') ?? null;

    const loaded = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      (adapter) => adapter.issues.listAll(),
    );
    const allIssues: Issue[] = loaded ?? [];
    const filtered = allIssues.filter((issue) => {
      if (severityFilter.length > 0 && !severityFilter.includes(issue.severity)) return false;
      if (ruleFilter.length > 0 && !matchesRuleFilter(issue.ruleId, ruleFilter)) return false;
      if (nodePath !== null && !issue.nodeIds.includes(nodePath)) return false;
      return true;
    });

    return c.json(
      buildListEnvelope({
        kind: 'issues',
        items: filtered,
        filters: {
          severity: severityFilter.length > 0 ? severityFilter : null,
          ruleId: ruleFilter.length > 0 ? ruleFilter : null,
          node: nodePath,
        },
        total: filtered.length,
        kindRegistry: deps.kindRegistry,
      }),
    );
  });
}
