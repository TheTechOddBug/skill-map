/**
 * `GET /api/folders`, lightweight full-corpus projection.
 *
 * One item per scanned node `{ path, kind, linksInCount, linksOutCount,
 * tokensTotal, modifiedAtMs, errorCount, warnCount, sidecarStatus }`,
 * only cheap scalar columns of `scan_nodes` (no frontmatter / body /
 * links / signals / contributions) and no pagination. Feeds the SPA
 * folders tree so it renders the WHOLE corpus (up to `scan.maxScan`)
 * with per-folder issue badges without hydrating the full `ScanResult`
 * (the graph map lazy-loads its branch via `/api/branch`).
 *
 * `errorCount` / `warnCount` are the count of error / warn issues whose
 * `nodeIds` include that path, the same per-node incidence the UI's
 * `countIssuesByPath` rolls up across descendants. They are computed in
 * SQL via `port.scans.issueCountsByPath()` (`json_each` + `GROUP BY`),
 * never by loading every issue into memory. The `info` severity is
 * intentionally ignored (the tree badges only error / warn).
 *
 * `sidecarStatus` is the node's sidecar drift status
 * (`scan_nodes.sidecar_status`), `null` when there is no parseable
 * sidecar, so the folders rail can flag per-row staleness without
 * hydrating the branch payload.
 *
 * Response is the canonical list envelope (`kind: 'folders'`), mirroring
 * `/api/nodes` / `/api/links`. No pagination: the complete tree is the
 * point and the corpus is already bounded by `scan.maxScan`, so
 * `counts.total` equals `items.length` and there is no `counts.page`.
 *
 * DB absent → zero items (mirrors every other read route: the SPA polls
 * `/api/health` for the missing-DB state and renders an empty tree).
 */

import type { Hono } from 'hono';

import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { buildListEnvelope } from '../envelope.js';
import type { IRouteDeps } from './deps.js';

interface IFolderItem {
  path: string;
  kind: string;
  linksInCount: number;
  linksOutCount: number;
  tokensTotal: number | null;
  modifiedAtMs: number | null;
  errorCount: number;
  warnCount: number;
  sidecarStatus: string | null;
}

export function registerFoldersRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/folders', async (c) => {
    const loaded = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false },
      async (adapter) => {
        const [liteNodes, issueCounts] = await Promise.all([
          adapter.scans.listLiteNodes(),
          adapter.scans.issueCountsByPath(),
        ]);
        return { liteNodes, issueCounts };
      },
    );
    const liteNodes = loaded?.liteNodes ?? [];
    const issueCounts = loaded?.issueCounts ?? new Map();
    const items: IFolderItem[] = liteNodes.map((n) => {
      const counts = issueCounts.get(n.path);
      return {
        path: n.path,
        kind: n.kind,
        linksInCount: n.linksInCount,
        linksOutCount: n.linksOutCount,
        tokensTotal: n.tokensTotal,
        modifiedAtMs: n.modifiedAtMs,
        errorCount: counts?.error ?? 0,
        warnCount: counts?.warn ?? 0,
        sidecarStatus: n.sidecarStatus,
      };
    });

    return c.json(
      buildListEnvelope({
        kind: 'folders',
        items,
        filters: {},
        total: items.length,
        kindRegistry: deps.kindRegistry,
        providerRegistry: deps.providerRegistry,
        contributionsRegistry: deps.contributionsRegistry,
      }),
    );
  });
}
