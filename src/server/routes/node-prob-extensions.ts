/**
 * `GET /api/nodes/:pathB64/prob-extensions`, the per-node probabilistic
 * launcher catalog for the inspector's two-state finder buttons (Step 16,
 * `spec/cli-contract.md` §Serve route table; classification per ROADMAP
 * §Step 16, manifest-mechanical). Two buckets:
 *
 *   - `finders`: probabilistic Analyzers whose precondition matches the
 *     node (the same `nodeMatchesPrecondition` gate the CLI `--all`
 *     fan-out applies) AND that have at least one matching fixer, i.e.
 *     `fixerIds` non-empty. `fixerIds` is the inverse Modelo-B lookup
 *     (`resolveMatchingFixerIds` over the composed probabilistic Actions,
 *     the SAME shared resolver the auto-fix hook and the record chain
 *     use). `hasOpenFindings` drives the Detect <-> Fix morph: true when
 *     the node carries >= 1 UNRESOLVED (not `fixed`), non-stale finding
 *     of THIS finder's extension id.
 *   - `standalone`: probabilistic Analyzers matching the node with NO
 *     fixer (`fixerIds` empty), PLUS probabilistic Actions WITHOUT
 *     `analyzerIds`, listed whenever their precondition matches. Single
 *     action buttons: `fixerIds` empty, `hasOpenFindings` always false.
 *
 * The former per-finder-fixer split and the `fixers` bucket are RETIRED:
 * a fixer is now the second state of its finder's button, never its own
 * standalone launcher, so probabilistic Actions WITH `analyzerIds` (the
 * fixers) are no longer listed at all.
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
import {
  resolveMatchingFixerIds,
  type IFixerCandidateAction,
} from '../../core/jobs/auto-fix-chain.js';
import { fixerAnalyzerIds, nodeMatchesPrecondition } from '../../core/jobs/submit-engine.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { IAction, IAnalyzer } from '../../kernel/extensions/index.js';
import { isProbabilistic } from '../../kernel/jobs/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import type { Job, Node } from '../../kernel/types.js';
import type { IFindingRecord } from '../../kernel/types/storage.js';
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
  /**
   * Qualified ids of the fixer Actions whose `precondition.analyzerIds`
   * name this finder (the inverse Modelo-B lookup). Non-empty ONLY on
   * `finders`-bucket entries; empty for standalone entries (finders with
   * no fixer, and Actions without `analyzerIds`). In manual mode the
   * button's Fix state submits each of these; in automatic mode the
   * finder submits with `autoFix: true` and the kernel chains them.
   */
  fixerIds: string[];
  /**
   * True when the node carries >= 1 UNRESOLVED (not `fixed`), non-stale
   * finding emitted by THIS finder's extension id. Drives the two-state
   * button: `false` -> Detect (submit the finder), `true` -> Fix (submit
   * `fixerIds`). Always `false` for standalone entries.
   */
  hasOpenFindings: boolean;
}

/** The `item` payload of the `node.prob-extensions` single envelope. */
export interface IProbExtensionsCatalog {
  finders: IProbExtensionEntry[];
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
  // The composed probabilistic Actions projected once (boot-cached, audit
  // M3) to the minimal `{ id, analyzerIds }` shape the shared inverse
  // Modelo-B resolver reads, mirroring the hook / record-path projection.
  const projectedActions: IFixerCandidateAction[] = probActions.map((a) => ({
    id: qualifiedExtensionId(a.pluginId, a.id),
    analyzerIds: a.precondition?.analyzerIds ?? [],
  }));

  app.get('/api/nodes/:pathB64/prob-extensions', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));

    const item = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      async (adapter) => {
        const bundle = await adapter.scans.findNode(nodePath);
        if (!bundle) return null;
        return buildCatalog(adapter, bundle.node, {
          probAnalyzers,
          probActions,
          projectedActions,
          runtime,
        });
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
  /** `probActions` projected to `{ id, analyzerIds }` for the fixer resolver. */
  projectedActions: IFixerCandidateAction[];
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
  if (node.virtual === true) return { finders: [], standalone: [] };

  // ONE findings read (stale included, we filter staleness ourselves for
  // the `hasOpenFindings` morph) and ONE jobs read for the whole catalog;
  // the per-entry decoration only touches `state_executions` for the
  // extensions that survived.
  const findings = await adapter.findings.list({ nodeId: node.path, includeStale: true });
  const activeJobs = (await adapter.jobs.list({ nodeId: node.path })).filter(
    (j) => j.status === 'queued' || j.status === 'running',
  );

  const finders: IProbExtensionEntry[] = [];
  const standalone: IProbExtensionEntry[] = [];

  for (const analyzer of sources.probAnalyzers) {
    if (!nodeMatchesPrecondition(node, analyzer.precondition)) continue;
    const qualified = qualifiedExtensionId(analyzer.pluginId, analyzer.id);
    const fixerIds = resolveMatchingFixerIds(qualified, sources.projectedActions);
    if (fixerIds.length > 0) {
      // A finder WITH a fixer: it becomes a two-state button. Report its
      // fixer(s) + whether it has open findings to drive Detect <-> Fix.
      finders.push(
        await buildEntry(adapter, node, analyzer, activeJobs, {
          fixerIds,
          hasOpenFindings: nodeHasOpenFindings(findings, qualified),
        }),
      );
    } else {
      // A finder WITHOUT a fixer stays a single Detect button: no fixer
      // to morph into, so `hasOpenFindings` is meaningless (always false).
      standalone.push(
        await buildEntry(adapter, node, analyzer, activeJobs, {
          fixerIds: [],
          hasOpenFindings: false,
        }),
      );
    }
  }
  for (const action of sources.probActions) {
    // A probabilistic Action WITH `analyzerIds` is a FIXER: it is the
    // second state of its finder's button, never its own launcher, so it
    // is no longer listed at all.
    if (fixerAnalyzerIds('action', action) !== undefined) continue;
    if (!nodeMatchesPrecondition(node, action.precondition)) continue;
    standalone.push(
      await buildEntry(adapter, node, action, activeJobs, {
        fixerIds: [],
        hasOpenFindings: false,
      }),
    );
  }

  return { finders, standalone };
}

/**
 * True when the node carries at least one UNRESOLVED (not `fixed`),
 * non-stale finding emitted by `finderQualifiedId`
 * (`rest-envelope.schema.json#/$defs/ProbExtensionEntry.hasOpenFindings`).
 * A `fixed` row is done (re-checkable), a stale row awaits a re-run, so
 * neither keeps the button in its Fix state. `human-decision` rows count
 * (they are not `fixed`): the finder still surfaced something open.
 */
function nodeHasOpenFindings(
  findings: readonly IFindingRecord[],
  finderQualifiedId: string,
): boolean {
  return findings.some(
    (f) =>
      f.origin === 'extension' &&
      f.extensionId === finderQualifiedId &&
      f.resolution !== 'fixed' &&
      f.stale === false,
  );
}

/** Base entry: id, description, live queue state + active job handle, last judgment, fixer fields. */
async function buildEntry(
  adapter: StoragePort,
  node: Node,
  extension: IAction | IAnalyzer,
  activeJobs: readonly Job[],
  extras: { fixerIds: string[]; hasOpenFindings: boolean },
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
    fixerIds: extras.fixerIds,
    hasOpenFindings: extras.hasOpenFindings,
  };
}
