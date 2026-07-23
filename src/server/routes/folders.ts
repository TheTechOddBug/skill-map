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
 * `errorCount` / `warnCount` are the node's TOTAL problem incidence per
 * severity, BOTH provenances summed (user call 2026-07-23, matching the
 * card's aggregate severity chips): deterministic issues whose `nodeIds`
 * include the path (`port.scans.issueCountsByPath()`, `json_each` +
 * `GROUP BY`) PLUS the node's fresh unresolved probabilistic findings
 * (`port.findings.countUnresolvedByPath()`, the same read-time source
 * the severity fold on /api/scan / /api/branch consumes). Both are
 * computed in SQL, never by loading rows into memory. The `info`
 * severity is intentionally ignored (the tree badges only error /
 * warn). Live freshness rides the collection loader's existing
 * refresh triggers (scan.completed + job.completed + reconnect).
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
import { bffReadVersionCheck } from '../util/db-read-check.js';
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
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      async (adapter) => {
        const [liteNodes, issueCounts] = await Promise.all([
          adapter.scans.listLiteNodes(),
          adapter.scans.issueCountsByPath(),
        ]);
        const findingCounts = await adapter.findings.countUnresolvedByPath(
          liteNodes.map((n) => n.path),
        );
        return { liteNodes, issueCounts, findingCounts };
      },
    );
    const liteNodes = loaded?.liteNodes ?? [];
    const issueCounts = loaded?.issueCounts ?? new Map();
    const findingCounts = loaded?.findingCounts ?? new Map();
    const items: IFolderItem[] = liteNodes.map((n) =>
      toFolderItem(n, issueCounts.get(n.path), findingCounts.get(n.path)),
    );

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

/**
 * One wire item; the badge counts SUM both provenances (deterministic
 * issues + fresh unresolved findings), matching the card's aggregate
 * severity chips. Split out of the route closure for the complexity cap.
 */
function toFolderItem(
  n: {
    path: string;
    kind: string;
    linksInCount: number;
    linksOutCount: number;
    tokensTotal: number | null;
    modifiedAtMs: number | null;
    sidecarStatus: string | null;
  },
  issues: { error: number; warn: number } | undefined,
  findings: { error: number; warn: number } | undefined,
): IFolderItem {
  return {
    path: n.path,
    kind: n.kind,
    linksInCount: n.linksInCount,
    linksOutCount: n.linksOutCount,
    tokensTotal: n.tokensTotal,
    modifiedAtMs: n.modifiedAtMs,
    errorCount: badgeCount(issues, findings, 'error'),
    warnCount: badgeCount(issues, findings, 'warn'),
    sidecarStatus: n.sidecarStatus,
  };
}

/** Sum one severity across both provenance maps (absent entry = 0). */
function badgeCount(
  issues: { error: number; warn: number } | undefined,
  findings: { error: number; warn: number } | undefined,
  key: 'error' | 'warn',
): number {
  return (issues?.[key] ?? 0) + (findings?.[key] ?? 0);
}

