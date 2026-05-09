/**
 * `GET /api/scan` — return the latest persisted `ScanResult`.
 * `GET /api/scan?fresh=1` — run a fresh in-memory scan (no persist).
 *
 * Both branches return the `ScanResult` shape 1:1 with
 * `spec/schemas/scan-result.schema.json` (byte-equal to `sm scan --json`).
 * No envelope wrap — the SPA branches on the same `schemaVersion` field
 * as every other ScanResult consumer.
 *
 * Behavior:
 *
 *   - DB missing + no `?fresh=1` → return the kernel's empty `ScanResult`
 *     shape (zero nodes / links / issues, synthetic meta). Rationale:
 *     `/api/health` already reports `db: 'missing'`; the SPA polls health
 *     and decides whether to render an empty-state CTA. A hard 404 here
 *     would force the SPA to special-case two failure modes.
 *
 *   - DB present (with or without rows) → `loadScanResult` returns the
 *     persisted snapshot (an empty DB yields an empty ScanResult — same
 *     shape, no error).
 *
 *   - `?fresh=1` + server booted with `--no-built-ins` or `--no-plugins`
 *     → 400 `bad-query`. A fresh scan with neither pipeline yields an
 *     empty / partial result that surprises the caller.
 *
 *   - `?fresh=1` otherwise → run `runScanForCommand` against the server's
 *     `runtimeContext`; the result is returned without persistence (the
 *     scan-runner's `dryRun: true` branch).
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import type { ScanResult } from '../../kernel/index.js';
import { runScanForCommand } from '../../core/runtime/scan-runner.js';
import type { IPrinter } from '../../core/runtime/printer.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { log } from '../../kernel/util/logger.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { parseBooleanFlag } from '../util/parse-query.js';
import type { IRouteDeps } from './deps.js';

export function registerScanRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/scan', async (c) => {
    if (parseBooleanFlag(c.req.query('fresh'))) {
      return c.json(await runFreshScan(deps));
    }
    return c.json(await loadPersistedScan(deps));
  });
}

async function loadPersistedScan(deps: IRouteDeps): Promise<ScanResult> {
  const opened = await tryWithSqlite(
    { databasePath: deps.options.dbPath, autoBackup: false },
    async (adapter) => {
      const [loaded, favSet] = await Promise.all([
        adapter.scans.load(),
        adapter.favorites.listPaths(),
      ]);
      // Phase 4 / View contribution system — `/api/scan` is the
      // canonical node corpus the SPA's `CollectionLoaderService`
      // hydrates from on F5 / cold boot. Decorate every node with
      // its persisted contributions + tags so the inspector / card
      // slot hosts have data to render. Mirrors the per-item embed
      // on `/api/nodes` (single + bulk). Bulk load via
      // `listForPaths(...)` to keep the round-trip count at two.
      const paths = loaded.nodes.map((n) => n.path);
      const [contribRows, tagRows] = await Promise.all([
        adapter.contributions.listForPaths(paths),
        adapter.tags.listForPaths(paths),
      ]);
      const byPath = new Map<string, typeof contribRows>();
      for (const r of contribRows) {
        const list = byPath.get(r.nodePath);
        if (list) list.push(r);
        else byPath.set(r.nodePath, [r]);
      }
      const tagBuckets = new Map<string, { tag: string; source: 'author' | 'user' }[]>();
      for (const r of tagRows) {
        const list = tagBuckets.get(r.nodePath);
        if (list) list.push({ tag: r.tag, source: r.source });
        else tagBuckets.set(r.nodePath, [{ tag: r.tag, source: r.source }]);
      }
      return { loaded, favSet, contribByPath: byPath, tagBuckets };
    },
  );
  if (opened === null) {
    // DB file absent — return the empty ScanResult shape so the SPA can
    // render an empty state without special-casing two failure modes.
    return emptyScanResult();
  }
  // Decorate every node with `isFavorite` from the favorites Set AND
  // `contributions[]` AND `tags` (dual-source projection) — mirror of
  // the per-route decorator on `/api/nodes`. The SPA's
  // `CollectionLoaderService` reads `/api/scan` as the canonical
  // node corpus, so this is the load-time path that the F5 / cold
  // boot uses; without it, refreshing the page silently drops the
  // user's favorites and tags from the in-memory store.
  return {
    ...opened.loaded,
    nodes: opened.loaded.nodes.map((n) => ({
      ...n,
      isFavorite: opened.favSet.has(n.path),
      contributions: opened.contribByPath.get(n.path) ?? [],
      tags: groupTagsBySource(opened.tagBuckets.get(n.path) ?? []),
    })),
  };
}

/**
 * Group a node's tag rows into the wire-shape `{ byAuthor, byUser }`.
 * Sorted ascending within each source, deduped (defensive against
 * legacy callers that bypass the PK constraint).
 */
function groupTagsBySource(rows: readonly { tag: string; source: 'author' | 'user' }[]): {
  byAuthor: string[];
  byUser: string[];
} {
  const byAuthor = new Set<string>();
  const byUser = new Set<string>();
  for (const r of rows) (r.source === 'author' ? byAuthor : byUser).add(r.tag);
  return {
    byAuthor: [...byAuthor].sort(),
    byUser: [...byUser].sort(),
  };
}

async function runFreshScan(deps: IRouteDeps): Promise<ScanResult> {
  if (deps.options.noBuiltIns || deps.options.noPlugins) {
    throw new HTTPException(400, { message: SERVER_TEXTS.freshScanRequiresPipeline });
  }
  // Plugin warnings go to `log.warn` — same surface the rest of the
  // BFF uses. Fresh scans through the BFF are a development affordance;
  // warnings belong in the server's own log stream, not the JSON
  // response. The runner's `stderr` parameter still feeds the kernel's
  // progress emitter (no log shape for those events at 14.x).
  //
  // `noBuiltIns` / `noPlugins` forward verbatim from the gated
  // options bag — the early HTTP 400 above already rejected the
  // truthy combinations, so passing the values through preserves the
  // intent (audit m7) without hardcoding `false` literals that would
  // drift if a third pipeline flag ever lands.
  const outcome = await runScanForCommand({
    roots: [deps.runtimeContext.cwd],
    noBuiltIns: deps.options.noBuiltIns,
    noPlugins: deps.options.noPlugins,
    noTokens: false,
    dryRun: true,
    changed: false,
    allowEmpty: true,
    strict: false,
    stderr: process.stderr,
    ctx: deps.runtimeContext,
    // M3: reuse the boot-cached pluginRuntime so a fresh scan over
    // the BFF doesn't re-walk `.skill-map/plugins/` per request. A
    // freshly-installed plugin needs an `sm serve` restart (the rest
    // of the BFF already classified against the boot snapshot —
    // discovering new plugins here would surface them in scan output
    // but not in `/api/plugins` or the kindRegistry).
    pluginRuntime: deps.pluginRuntime,
    // M8: explicit printer instead of the runner's old stdout=stderr
    // fallback. The fresh-scan response body IS the ScanResult JSON,
    // so `data` is never used here; warn/info/error route through
    // `log.warn` (same surface the rest of the BFF uses).
    printer: bffScanRunnerPrinter,
  });
  if (outcome.kind !== 'ok') {
    throw new HTTPException(500, {
      message: outcome.kind === 'guard-trip'
        ? `fresh scan refused (existing rows: ${outcome.existing})`
        : outcome.message,
    });
  }
  return outcome.result;
}

/**
 * Printer for the fresh-scan path. The BFF response body is the
 * ScanResult JSON itself; the printer's `data` channel would be a
 * wire-format conflict if it ever fired, so we make the contract
 * explicit by discarding `data` and routing the diagnostic channels
 * to `log.warn`. With `pluginRuntime` cached at boot (M3) the
 * plugin-warning surface is already covered there too — this printer
 * is effectively a structural guard against future drift.
 */
const bffScanRunnerPrinter: IPrinter = {
  data: () => { /* discard — fresh-scan response body is the ScanResult */ },
  info: (text) => log.warn(sanitizeForTerminal(text.trimEnd())),
  warn: (text) => log.warn(sanitizeForTerminal(text.trimEnd())),
  error: (text) => log.warn(sanitizeForTerminal(text.trimEnd())),
};

/**
 * Empty `ScanResult` returned when the DB file is absent. Mirrors the
 * shape `loadScanResult` produces against an empty migrated DB so the
 * SPA never sees a structurally different payload.
 */
function emptyScanResult(): ScanResult {
  return {
    schemaVersion: 1,
    scannedAt: Date.now(),
    scope: 'project',
    roots: ['.'],
    providers: [],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

