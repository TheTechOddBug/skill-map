/**
 * `GET /api/nodes/:pathB64/prob-extensions`, the per-node probabilistic
 * launcher catalog (Step 16 piece 1, `spec/cli-contract.md` §Serve route
 * table; classification per ROADMAP §Step 16, manifest-mechanical):
 *
 *   - `finders`: probabilistic Analyzers whose precondition matches the
 *     node (the same `nodeMatchesPrecondition` gate the CLI `--all`
 *     fan-out applies). Always listed.
 *   - `fixers`: probabilistic Actions declaring a non-empty
 *     `precondition.analyzerIds`, listed ONLY when the node carries >= 1
 *     matching finding (stale INCLUDED, via `selectFixerFindings`, the
 *     same `matchesQualifiedExtensionFilter` join the auto-fix hook
 *     uses), each entry carrying that tally as `findingCount`. Zero
 *     matching findings hides the launcher, mirroring the kernel's
 *     no-findings submit refusal.
 *   - `standalone`: probabilistic Actions WITHOUT `analyzerIds`, listed
 *     whenever their precondition matches.
 *
 * Each entry adds the live queue `state` (`queued` / `running` when an
 * active `state_jobs` row exists for the (node, extension) pair, else
 * `idle`), `jobId` (the ACTIVE job's id, the handle the UI's
 * stop/restart affordance cancels via `POST /api/jobs/:jobId/cancel`;
 * `null` when idle) and `lastJudged` (the latest COMPLETED
 * `state_executions` row for the pair: `{ at, model }`, `null` when the
 * extension never judged this node; a failed / cancelled execution
 * produced no judgment, so it does not count).
 *
 * The extension catalogs are composed ONCE at route registration from
 * the BOOT-CACHED plugin runtime (audit M3: never re-walk
 * `.skill-map/plugins/` per request), matching the watcher's "loaded
 * once at boot" contract; a plugin installed or toggled mid-session
 * registers on the next `sm serve` restart.
 *
 * A VIRTUAL node answers 200 with three empty arrays: it has no backing
 * file to render, so nothing is launchable against it (the submit route
 * refuses it too). 404 rules: malformed `pathB64`, unknown node, and
 * missing DB all answer 404 `not-found`.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import {
  buildActionRuntime,
  type IActionRuntime,
} from '../../core/jobs/action-runtime.js';
import { fixerAnalyzerIds, nodeMatchesPrecondition } from '../../core/jobs/submit-engine.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { IAction, IAnalyzer } from '../../kernel/extensions/index.js';
import { isProbabilistic, selectFixerFindings } from '../../kernel/jobs/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import type { Job, Node } from '../../kernel/types.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import { log } from '../../kernel/util/logger.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { buildSingleEnvelope } from '../envelope.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { bffReadVersionCheck } from '../util/db-read-check.js';
import type { IRouteDeps } from './deps.js';
import { decodePathB64Or404 } from './node-loader.js';

/** One launcher entry (`rest-envelope.schema.json#/$defs/ProbExtensionEntry`). */
export interface IProbExtensionEntry {
  /** Qualified extension id, the value `POST .../jobs` accepts as `extension`. */
  id: string;
  /** The manifest's required `description` (launcher tooltip / subtitle). */
  description: string;
  state: 'idle' | 'queued' | 'running';
  /**
   * The ACTIVE queued/running job's id for this pair, the handle the
   * UI's stop/restart affordance cancels (`POST /api/jobs/:jobId/cancel`).
   * `null` when idle.
   */
  jobId: string | null;
  lastJudged: { at: number; model: string | null } | null;
  /** Fixer entries only: the matching-findings tally that made it visible. */
  findingCount?: number;
}

/** The `item` payload of the `node.prob-extensions` single envelope. */
export interface IProbExtensionsCatalog {
  finders: IProbExtensionEntry[];
  fixers: IProbExtensionEntry[];
  standalone: IProbExtensionEntry[];
}

export function registerNodeProbExtensionsRoute(app: Hono, deps: IRouteDeps): void {
  // Composed once at boot from the cached plugin runtime (audit M3);
  // plugin-runtime warnings land in the server log exactly once.
  const runtime = buildActionRuntime(deps.pluginRuntime, (line) =>
    log.warn(sanitizeForTerminal(line)),
  );
  const probAnalyzers = runtime.analyzers.filter((a) => isProbabilistic(a));
  const probActions = runtime.actions.filter((a) => isProbabilistic(a));

  app.get('/api/nodes/:pathB64/prob-extensions', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));

    const item = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      async (adapter) => {
        const bundle = await adapter.scans.findNode(nodePath);
        if (!bundle) return null;
        return buildCatalog(adapter, bundle.node, { probAnalyzers, probActions, runtime });
      },
    );
    if (item === null) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.nodeNotFound, { path: sanitizeForTerminal(nodePath) }),
      });
    }

    return c.json(
      buildSingleEnvelope(
        'node.prob-extensions',
        item,
        deps.kindRegistry,
        deps.providerRegistry,
        deps.contributionsRegistry,
      ),
    );
  });
}

interface ICatalogSources {
  probAnalyzers: IAnalyzer[];
  probActions: IAction[];
  runtime: IActionRuntime;
}

/**
 * Classify the composed probabilistic extensions against one node and
 * decorate each surviving entry with its live queue state + last
 * judgment. Runs inside the request's single read-posture DB open.
 */
async function buildCatalog(
  adapter: StoragePort,
  node: Node,
  sources: ICatalogSources,
): Promise<IProbExtensionsCatalog> {
  // A virtual node has no backing file: nothing is launchable, the
  // submit route refuses it, so the catalog is honestly empty.
  if (node.virtual === true) return { finders: [], fixers: [], standalone: [] };

  // ONE findings read (stale included, the fixer join needs them) and
  // ONE jobs read for the whole catalog; the per-entry decoration only
  // touches `state_executions` for the extensions that survived.
  const findings = await adapter.findings.list({ nodeId: node.path, includeStale: true });
  const activeJobs = (await adapter.jobs.list({ nodeId: node.path })).filter(
    (j) => j.status === 'queued' || j.status === 'running',
  );

  const finders: IProbExtensionEntry[] = [];
  const fixers: IProbExtensionEntry[] = [];
  const standalone: IProbExtensionEntry[] = [];

  for (const analyzer of sources.probAnalyzers) {
    if (!nodeMatchesPrecondition(node, analyzer.precondition)) continue;
    finders.push(await buildEntry(adapter, node, analyzer, activeJobs));
  }
  for (const action of sources.probActions) {
    const analyzerIds = fixerAnalyzerIds('action', action);
    if (analyzerIds !== undefined) {
      // FIXER: the finding gate IS the matcher (spec route table); a
      // lane no finder ever judged on this node hides the launcher.
      const selected = selectFixerFindings(findings, analyzerIds);
      if (selected.length === 0) continue;
      fixers.push({
        ...(await buildEntry(adapter, node, action, activeJobs)),
        findingCount: selected.length,
      });
      continue;
    }
    if (!nodeMatchesPrecondition(node, action.precondition)) continue;
    standalone.push(await buildEntry(adapter, node, action, activeJobs));
  }

  return { finders, fixers, standalone };
}

/** Base entry: id, description, live queue state + active job handle, last judgment. */
async function buildEntry(
  adapter: StoragePort,
  node: Node,
  extension: IAction | IAnalyzer,
  activeJobs: readonly Job[],
): Promise<IProbExtensionEntry> {
  const qualified = qualifiedExtensionId(extension.pluginId, extension.id);
  const mine = activeJobs.filter((j) => j.extensionId === qualified);
  // `running` wins over `queued` when both exist (distinct content
  // hashes can hold one of each); an idle pair has no active row. The
  // exposed `jobId` is the row that DECIDED the state (the running one
  // when it wins), so the cancel handle always targets the job the
  // launcher is visibly showing.
  const runningJob = mine.find((j) => j.status === 'running');
  const activeJob = runningJob ?? mine[0];
  const state = runningJob !== undefined ? 'running' : mine.length > 0 ? 'queued' : 'idle';
  // Latest COMPLETED execution for the pair (`history.list` orders
  // `startedAt` desc); `at` is the record stamp (`finishedAt`).
  const [latest] = await adapter.history.list({
    nodePath: node.path,
    extensionId: qualified,
    statuses: ['completed'],
    limit: 1,
  });
  return {
    id: qualified,
    description: extension.description,
    state,
    jobId: activeJob?.id ?? null,
    lastJudged: latest ? { at: latest.finishedAt, model: latest.model ?? null } : null,
  };
}
