/**
 * `GET /api/nodes/:pathB64/summary`, the node's stored semantic
 * summaries (`state_summaries`, written by a summarizer Action's
 * `sm record`) for the inspector header's semantic-analysis affordance
 * (`spec/cli-contract.md` §Serve route table).
 *
 * DIRECT shape (envelope-exempt, same posture as `/api/branch` and the
 * activity routes): `{ items: [{ summarizerActionId, generatedAt,
 * stale, report }] }`, ordered by `summarizerActionId` ASC as the port
 * returns them. `stale` derives per row by comparing the summary's
 * `bodyHashAtGeneration` against the node's live `scan_nodes.body_hash`
 * (same rule `sm show` applies). A node with no summaries answers an
 * empty `items`, never 404; malformed `pathB64`, unknown node, and
 * missing DB all answer 404 `not-found`.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import type { IRouteDeps } from './deps.js';
import { decodePathB64Or404 } from './node-loader.js';

/** One wire summary row (identity + freshness + the recorded report). */
interface ISummaryWireRow {
  summarizerActionId: string;
  generatedAt: number;
  /** True when the node body changed since this summary was recorded. */
  stale: boolean;
  report: Record<string, unknown>;
}

export function registerNodeSummaryRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/nodes/:pathB64/summary', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));
    const loaded = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      async (adapter) => {
        const bundle = await adapter.scans.findNode(nodePath);
        if (!bundle) return null;
        const rows = await adapter.summaries.forNode(nodePath);
        const items: ISummaryWireRow[] = rows.map((row) => ({
          summarizerActionId: row.summarizerActionId,
          generatedAt: row.generatedAt,
          stale: row.bodyHashAtGeneration !== bundle.node.bodyHash,
          report: row.report,
        }));
        return { items };
      },
    );
    if (loaded === null) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
      });
    }
    return c.json(loaded);
  });
}
