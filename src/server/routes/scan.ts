/**
 * `GET  /api/scan`            , latest persisted `ScanResult`.
 * `GET  /api/scan?fresh=1`    , fresh in-memory scan, no persist.
 * `POST /api/scan`            , fresh scan AND persist (manual refresh).
 *
 * All three branches return the `ScanResult` shape 1:1 with
 * `spec/schemas/scan-result.schema.json` (byte-equal to `sm scan --json`).
 * No envelope wrap, the SPA branches on the same `schemaVersion` field
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
 *     persisted snapshot (an empty DB yields an empty ScanResult, same
 *     shape, no error).
 *
 *   - `?fresh=1` + server booted with `--no-built-ins` or `--no-plugins`
 *     → 400 `bad-query`. A fresh scan with neither pipeline yields an
 *     empty / partial result that surprises the caller.
 *
 *   - `?fresh=1` otherwise → run `runScanForCommand` against the server's
 *     `runtimeContext`; the result is returned without persistence (the
 *     scan-runner's `dryRun: true` branch).
 *
 *   - `POST /api/scan` → run + persist via the same pipeline. Errors:
 *     `400 bad-query` when `--no-built-ins` / `--no-plugins` (would
 *     persist a partial DB), `409 scan-busy` when another scan is in
 *     flight (process-level mutex in `scan-mutex.ts`), `500 db-missing`
 *     when the project DB is absent (mutations cannot degrade). The
 *     route's `emitterFactory` wires the broadcaster so connected
 *     clients receive `scan.started` / `scan.completed` envelopes, a
 *     reactive `CollectionLoaderService` instance refreshes itself.
 */

import type { Context, Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import type { ScanResult } from '../../kernel/index.js';
import { buildFreshResolver } from '../../core/runtime/fresh-resolver.js';
import { runScanForCommand } from '../../core/runtime/scan-runner.js';
import type { IPrinter } from '../../core/runtime/printer.js';
import { appendOperation } from '../../core/operations-log.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import { log } from '../../kernel/util/logger.js';
import { tx } from '../../kernel/util/tx.js';
import { ConflictError, DbMissingError } from '../app.js';
import type { WsBroadcaster } from '../broadcaster.js';
import { emptyScanResult } from '../empty-scan.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { ScanBusyError, withScanMutex } from '../scan-mutex.js';
import { noopWritable } from '../util/noop-writable.js';
import { parseBooleanFlag } from '../util/parse-query.js';
import { buildBroadcasterEmitter } from '../watcher.js';
import type { IRouteDeps } from './deps.js';
import { foldFindingsIntoSeverityChips } from '../../plugins/core/analyzers/issue-counter/severity-fold.js';

export interface IScanRouteDeps extends IRouteDeps {
  broadcaster: WsBroadcaster;
}

export function registerScanRoute(app: Hono, deps: IScanRouteDeps): void {
  app.get('/api/scan', async (c) => {
    if (parseBooleanFlag(c.req.query('fresh'))) {
      return c.json(await runFreshScan(deps));
    }
    if (parseBooleanFlag(c.req.query('meta'))) {
      return c.json(await loadPersistedScanMeta(deps));
    }
    return c.json(await loadPersistedScan(deps));
  });

  app.post('/api/scan', async (c) => runPersistedScan(c, deps));
}

async function runPersistedScan(c: Context, deps: IScanRouteDeps): Promise<Response> {
  if (deps.options.noBuiltIns || deps.options.noPlugins) {
    throw new HTTPException(400, { message: SERVER_TEXTS.scanPostRequiresFullPipeline });
  }
  // DB-missing gate, read paths degrade to the empty shape, but a
  // persist path cannot. Fail fast with `db-missing` instead of
  // letting the runner silently `withSqlite`-create a parallel DB
  // that the rest of the BFF (`/api/health`, watcher) does not see.
  const dbExists = await tryWithSqlite(
    { databasePath: deps.options.dbPath, autoBackup: false },
    async () => true,
  );
  if (dbExists !== true) {
    throw new DbMissingError(SERVER_TEXTS.scanPostDbMissing);
  }
  try {
    return await withScanMutex(async () => {
      // Build a fresh resolver from the layered config BEFORE invoking
      // the runner so a mid-session PATCH to `/api/plugins[/...]` is
      // honoured by this scan without restarting `sm serve`. The cached
      // `deps.pluginRuntimeHolder.current` carries the boot-time resolver; this one
      // overrides it just for this invocation. See
      // `core/runtime/fresh-resolver.ts` for the shared helper.
      const resolveEnabledOverride = await buildBffResolverOverride(deps);
      const outcome = await runScanForCommand({
        roots: [deps.runtimeContext.cwd],
        noBuiltIns: deps.options.noBuiltIns,
        noPlugins: deps.options.noPlugins,
        noTokens: false,
        dryRun: false,
        changed: false,
        allowEmpty: true,
        strict: false,
        stderr: noopWritable(),
        ctx: deps.runtimeContext,
        pluginRuntime: deps.pluginRuntimeHolder.current,
        resolveEnabledOverride,
        printer: bffScanRunnerPrinter,
        emitterFactory: () => buildBroadcasterEmitter(deps.broadcaster),
        // BFF has no TTY; ambiguous activeProvider must be resolved by
        // the operator via the Settings UI (PATCH /api/active-provider)
        // before the scan, not via interactive prompt here.
        yes: true,
        // Suppress the config-lens drift `⚠` warn on the server: the SPA
        // surfaces drift via `GET /api/active-provider`'s `markerDrift`,
        // so the server log would carry repetitive noise no operator
        // reads. `sm scan` / `sm watch` on the CLI keep the warn.
        warnOnDrift: false,
        // `--max-scan` (walk ceiling) and `--max-nodes` (render cap)
        // from the `sm serve` invocation (or the bare `sm --max-scan
        // <N>` / `sm --max-nodes <N>` shortcut) flow through to every
        // scan the BFF runs so both overrides are honoured end-to-end.
        ...(deps.options.maxScan !== undefined ? { maxScan: deps.options.maxScan } : {}),
        ...(deps.options.maxNodes !== undefined ? { maxNodes: deps.options.maxNodes } : {}),
      });
      if (outcome.kind !== 'ok') {
        throw new HTTPException(500, {
          message: outcome.kind === 'guard-trip'
            ? tx(SERVER_TEXTS.scanGuardTrip, { existing: outcome.existing })
            : outcome.message,
        });
      }
      appendOperation(deps.runtimeContext.cwd, {
        op: 'scan',
        target: '*',
        channel: 'ui',
        outcome: 'ok',
        detail: `nodes=${outcome.result.stats.nodesCount} issues=${outcome.result.stats.issuesCount}`,
      });
      return c.json(outcome.result);
    });
  } catch (err) {
    if (err instanceof ScanBusyError) {
      throw new ConflictError({ code: 'scan-busy', message: SERVER_TEXTS.scanPostBusy });
    }
    throw err;
  }
}

/**
 * Build the per-request `resolveEnabled` override the BFF threads into
 * `runScanForCommand`. Pulled out so both `runPersistedScan` and
 * `runFreshScan` share the same wiring without duplicating the
 * `IFreshResolverDeps` shape literal.
 */
async function buildBffResolverOverride(deps: IRouteDeps): Promise<(id: string) => boolean> {
  return buildFreshResolver({
    effectiveConfig: () => deps.configService.effective(),
  });
}

// Metadata-only read for `GET /api/scan?meta=1`. Returns the scan
// envelope with empty `nodes` / `links` / `issues` arrays (and real
// `COUNT(*)` stats) so the SPA hydrates its header + banners at boot
// without the full-corpus payload. No node decoration (favorites /
// contributions / tags) because there are no nodes in the response.
async function loadPersistedScanMeta(deps: IRouteDeps): Promise<ScanResult> {
  const opened = await tryWithSqlite(
    {
      databasePath: deps.options.dbPath,
      autoBackup: false,
      versionCheck: bffReadVersionCheck(),
    },
    async (adapter) => adapter.scans.loadMeta(),
  );
  if (opened === null) {
    return emptyScanResult();
  }
  return opened;
}

async function loadPersistedScan(deps: IRouteDeps): Promise<ScanResult> {
  const opened = await tryWithSqlite(
    {
      databasePath: deps.options.dbPath,
      autoBackup: false,
      // Read-side drift advisory (version skew + schema fingerprint).
      // The BFF has no TTY, warnings go to the server log; a newer /
      // different-major DB throws `DbVersionMismatchError`, which the
      // global `app.onError` maps to a 500 so the SPA surfaces it
      // rather than crashing on a cryptic missing-column read.
      versionCheck: bffReadVersionCheck(),
    },
    async (adapter) => {
      const [loaded, favSet] = await Promise.all([
        adapter.scans.load(),
        adapter.favorites.listPaths(),
      ]);
      // Phase 4 / View contribution system, `/api/scan` is the
      // canonical node corpus the SPA's `CollectionLoaderService`
      // hydrates from on F5 / cold boot. Decorate every node with
      // its persisted contributions + tags so the inspector / card
      // slot hosts have data to render. Mirrors the per-item embed
      // on `/api/nodes` (single + bulk). Bulk load via
      // `listForPaths(...)` to keep the round-trip count at two.
      const paths = loaded.nodes.map((n) => n.path);
      const [contribRows, tagRows, findingCounts] = await Promise.all([
        adapter.contributions.listForPaths(paths),
        adapter.tags.listForPaths(paths),
        // Read-time aggregate: fresh unresolved findings summed into
        // issue-counter's severity chips below, same fold as /api/nodes
        // (see issue-counter/severity-fold), so a cold boot / F5 shows the
        // combined count without waiting for the first per-node fetch.
        adapter.findings.countUnresolvedByPath(paths),
      ]);
      const byPath = new Map<string, typeof contribRows>();
      for (const r of contribRows) {
        const list = byPath.get(r.nodePath);
        if (list) list.push(r);
        else byPath.set(r.nodePath, [r]);
      }
      const tagsByPath = groupTagsByPath(tagRows);
      return { loaded, favSet, contribByPath: byPath, tagsByPath, findingCounts };
    },
  );
  if (opened === null) {
    // DB file absent, return the empty ScanResult shape so the SPA can
    // render an empty state without special-casing two failure modes.
    return emptyScanResult();
  }
  // Decorate every node with `isFavorite` from the favorites Set AND
  // `contributions[]` AND `tags` (flat `string[]` from the sidecar),
  // mirror of the per-route decorator on `/api/nodes`. The SPA's
  // `CollectionLoaderService` reads `/api/scan` as the canonical
  // node corpus, so this is the load-time path that the F5 / cold
  // boot uses; without it, refreshing the page silently drops the
  // user's favorites and tags from the in-memory store.
  return {
    ...opened.loaded,
    nodes: opened.loaded.nodes.map((n) => ({
      ...n,
      isFavorite: opened.favSet.has(n.path),
      contributions: foldFindingsIntoSeverityChips(
        opened.contribByPath.get(n.path) ?? [],
        opened.findingCounts.get(n.path) ?? { warn: 0, error: 0 },
        deps.contributionsRegistry,
        n.path,
      ),
      tags: opened.tagsByPath.get(n.path) ?? [],
    })),
  };
}

/**
 * Group bulk tag rows by node path into a flat `string[]` per node.
 * Tags are deduplicated per node (defensive against legacy callers
 * that bypass the PK constraint) and sorted ascending.
 */
function groupTagsByPath(
  rows: readonly { nodePath: string; tag: string }[],
): Map<string, string[]> {
  const buckets = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = buckets.get(r.nodePath);
    if (set) set.add(r.tag);
    else buckets.set(r.nodePath, new Set([r.tag]));
  }
  const out = new Map<string, string[]>();
  for (const [path, set] of buckets) out.set(path, [...set].sort());
  return out;
}

async function runFreshScan(deps: IRouteDeps): Promise<ScanResult> {
  if (deps.options.noBuiltIns || deps.options.noPlugins) {
    throw new HTTPException(400, { message: SERVER_TEXTS.freshScanRequiresPipeline });
  }
  // Plugin warnings go to `log.warn`, same surface the rest of the
  // BFF uses. Fresh scans through the BFF are a development affordance;
  // warnings belong in the server's own log stream, not the JSON
  // response. The runner's `stderr` parameter still feeds the kernel's
  // progress emitter (no log shape for those events at 14.x).
  //
  // `noBuiltIns` / `noPlugins` forward verbatim from the gated
  // options bag, the early HTTP 400 above already rejected the
  // truthy combinations, so passing the values through preserves the
  // intent (audit m7) without hardcoding `false` literals that would
  // drift if a third pipeline flag ever lands.
  // Same resolver freshness as `POST /api/scan`, a mid-session PATCH
  // applies to this fresh scan too (the cached bundle's
  // boot-time resolver is overridden for the duration of this call).
  const resolveEnabledOverride = await buildBffResolverOverride(deps);
  const outcome = await runScanForCommand({
    roots: [deps.runtimeContext.cwd],
    noBuiltIns: deps.options.noBuiltIns,
    noPlugins: deps.options.noPlugins,
    noTokens: false,
    dryRun: true,
    changed: false,
    allowEmpty: true,
    strict: false,
    stderr: noopWritable(),
    ctx: deps.runtimeContext,
    // M3: reuse the boot-cached pluginRuntime so a fresh scan over
    // the BFF doesn't re-walk `.skill-map/plugins/` per request. A
    // freshly-installed plugin needs an `sm serve` restart (the rest
    // of the BFF already classified against the boot snapshot,
    // discovering new plugins here would surface them in scan output
    // but not in `/api/plugins` or the kindRegistry).
    pluginRuntime: deps.pluginRuntimeHolder.current,
    resolveEnabledOverride,
    // M8: explicit printer instead of the runner's old stdout=stderr
    // fallback. The fresh-scan response body IS the ScanResult JSON,
    // so `data` is never used here; warn/info/error route through
    // `log.warn` (same surface the rest of the BFF uses).
    printer: bffScanRunnerPrinter,
    // BFF has no TTY; ambiguous activeProvider is the operator's
    // problem to resolve via the Settings UI, not via prompt here.
    yes: true,
    // Suppress the config-lens drift `⚠` warn on the server (same as
    // POST /api/scan): the SPA surfaces drift via
    // `GET /api/active-provider`'s `markerDrift` field.
    warnOnDrift: false,
    // Carry `--max-scan` (walk ceiling) and `--max-nodes` (render cap)
    // from `sm serve` into the fresh-scan path too so a UI-driven
    // refresh honours the same knobs as the watcher.
    ...(deps.options.maxScan !== undefined ? { maxScan: deps.options.maxScan } : {}),
    ...(deps.options.maxNodes !== undefined ? { maxNodes: deps.options.maxNodes } : {}),
  });
  if (outcome.kind !== 'ok') {
    throw new HTTPException(500, {
      message: outcome.kind === 'guard-trip'
        ? tx(SERVER_TEXTS.freshScanGuardTrip, { existing: outcome.existing })
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
 * plugin-warning surface is already covered there too, this printer
 * is effectively a structural guard against future drift.
 */
const bffScanRunnerPrinter: IPrinter = {
  data: () => { /* discard, fresh-scan response body is the ScanResult */ },
  info: (text) => log.warn(text.trimEnd()),
  warn: (text) => log.warn(text.trimEnd()),
  error: (text) => log.warn(text.trimEnd()),
};

// The read-side drift-advisory printer moved to `../util/db-read-check.ts`
// (`bffReadVersionCheck`), shared by every BFF read open.

// `emptyScanResult()` (DB-absent shape) lives in `../empty-scan.js` so
// the REST scan route and the MCP `skillmap://graph` resource share one
// definition.

