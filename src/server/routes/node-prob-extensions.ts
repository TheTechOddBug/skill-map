/**
 * `GET /api/nodes/:pathB64/prob-extensions`, the per-node probabilistic
 * launcher catalog for the inspector's finder buttons (Step 16,
 * `spec/cli-contract.md` §Serve route table; classification per ROADMAP
 * §Step 16, manifest-mechanical). Four buckets:
 *
 *   - `skills`: the boot-discovered skill-action catalog
 *     (`spec/skill-actions.md` §HTTP surface), one entry per installed
 *     skill on EVERY node, deterministically (no precondition, no
 *     eligibility heuristics: every skill takes the target file as its
 *     subject). The field is OPTIONAL on the wire (absent is NOT empty);
 *     the reference implementation always emits it, `[]` for an empty
 *     catalog. Entries decorate `state` / `jobId` over the SKILL's own
 *     active jobs only (no fixerIds union) and `lastJudged` from its
 *     latest completed execution, the same way `buildEntry` does.
 *
 *   - `finders`: probabilistic Analyzers whose precondition matches the
 *     node (the same `nodeMatchesPrecondition` gate the CLI `--all`
 *     fan-out applies) AND that have at least one matching fixer, i.e.
 *     `fixerIds` non-empty. `fixerIds` is the inverse Modelo-B lookup
 *     (`resolveMatchingFixerIds` over the composed probabilistic Actions,
 *     the SAME shared resolver the auto-fix hook and the record chain
 *     use). `hasOpenFindings` DISABLES the finder button (user call
 *     2026-07-20: re-running a finder whose findings are open makes no
 *     sense; the fix lives on each finding row): true when the node
 *     carries >= 1 UNRESOLVED (not `fixed`), non-stale finding of THIS
 *     finder's extension id.
 *   - `standalone`: probabilistic Analyzers matching the node with NO
 *     fixer (`fixerIds` empty), PLUS probabilistic Actions WITHOUT
 *     `analyzerIds` (listed whenever their precondition matches,
 *     including the `frontmatterMissing` gap gate when declared).
 *     Single action buttons: `fixerIds` empty, `hasOpenFindings`
 *     always false.
 *   - `issueFixers`: probabilistic Actions whose `analyzerIds` resolve
 *     to a DETERMINISTIC analyzer (e.g. `core/ai-reference-action` over
 *     `core/reference-broken`), listed ONLY while the node carries >= 1
 *     Issue from those analyzerIds. The UI renders each as a fix button
 *     ON the matching deterministic issue rows (matched via the entry's
 *     SHORT `analyzerIds`), never as a launcher button (user decision
 *     2026-07-22 replacing the former standalone placement): the
 *     analyzer emits `scan_issues`, never `state_findings`, so there is
 *     no finder button for it to ride and the affordance belongs on the
 *     issue it resolves.
 *
 * A fixer paired with a PROBABILISTIC finder is never its own launcher:
 * it surfaces through its finder's `fixerIds` (the per-finding fix button
 * in the tray submits them); the former per-finder-fixer split and the
 * `fixers` bucket stay RETIRED.
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
 * The extension catalogs are recomposed PER REQUEST from the
 * BOOT-CACHED plugin runtime (audit M3: never re-walk
 * `.skill-map/plugins/` per request) against a fresh enabled-resolver
 * built from the LIVE layered config. So a probabilistic analyzer / its
 * fixer toggled mid-session (via `PATCH /api/plugins[/...]` +
 * `configService.reload()`, or `sm plugins enable` running side by side)
 * surfaces here WITHOUT restarting `sm serve`, the same parity the scan
 * route already has (`core/runtime/fresh-resolver.ts`). The recompose is
 * an in-memory re-filter of the boot-cached runtime, no discovery pass.
 * A newly-INSTALLED plugin, or a drop-in that booted `startsAsDisabled`,
 * still needs an `sm serve` restart (the documented exception: its
 * handlers were never bucketed into the runtime).
 *
 * A VIRTUAL node answers 200 with four empty arrays: it has no backing
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
import { referencedAnalyzerMode } from '../../core/jobs/analyzer-mode.js';
import {
  resolveMatchingFixerIds,
  type IFixerCandidateAction,
} from '../../core/jobs/auto-fix-chain.js';
import { fixerAnalyzerIds, nodeMatchesPrecondition } from '../../core/jobs/submit-engine.js';
import { buildFreshResolver } from '../../core/runtime/fresh-resolver.js';
import {
  offeredSkillActionCatalog,
  type ISkillActionCatalog,
  type ISkillActionEntry,
} from '../../core/skill-actions/catalog.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';
import type { IAction, IAnalyzer } from '../../kernel/extensions/index.js';
import {
  isFindingSuppressed,
  isProbabilistic,
  type ISuppressionEntry,
} from '../../kernel/jobs/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { isLockedBuiltIn } from '../../plugins/locked-built-ins.js';
import type { Job, Node } from '../../kernel/types.js';
import type { IFindingRecord } from '../../kernel/types/storage.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
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
   * no fixer, Actions without `analyzerIds`, and deterministic-analyzer
   * fixers surfaced by a matching open Issue). The tray's per-finding
   * fix button submits each of these; in automatic mode the finder
   * submits with `autoFix: true` and the kernel chains them.
   */
  fixerIds: string[];
  /**
   * True when the node carries >= 1 UNRESOLVED (not `fixed`), non-stale
   * finding emitted by THIS finder's extension id. DISABLES the finder
   * button (handle the open findings first, from their rows; the button
   * re-enables once none is open). Always `false` for standalone entries.
   */
  hasOpenFindings: boolean;
  /**
   * Highest severity among the rows the findings tray LISTS for this
   * extension, both origins
   * (`rest-envelope.schema.json#/$defs/ProbExtensionEntry`): unresolved
   * and not class-suppressed, stale rows INCLUDED (they are listed,
   * marked). `null` = nothing listed (all resolved, never found
   * anything, or never judged; `lastJudged` disambiguates
   * client-side). Drives the launcher's verdict mark, so it always
   * agrees with the panel: severity while rows are listed, clean check
   * once the operator resolved them all.
   */
  findingsMaxSeverity: IFindingRecord['severity'] | null;
  /**
   * Frozen finding targets of the ACTIVE fixer jobs for this finder
   * (`spec/cli-contract.md` §GET /api/nodes/:pathB64/prob-extensions):
   * `all: true` when a whole-node fixer job (no `findingIds`) is active,
   * `findingIds` the union of the active subset jobs' ids. The tray
   * derives each row's fix-button busy state from it so fixing one
   * finding no longer spins every row (user decision 2026-07-22).
   * `null` when no fixer job is active (and always on standalone
   * entries).
   */
  fixerBusy: { all: boolean; findingIds: number[] } | null;
}

/**
 * One `issueFixers` entry
 * (`rest-envelope.schema.json#/$defs/IssueFixerEntry`): a probabilistic
 * Action fixing a DETERMINISTIC analyzer's issues, rendered as a fix
 * button on the matching issue rows. `state` / `jobId` cover the
 * action's OWN jobs only; `analyzerIds` carries the SHORT ids (as
 * persisted on `scan_issues.analyzerId`) the UI matches rows against.
 */
export interface IIssueFixerEntry {
  id: string;
  description: string;
  state: 'idle' | 'queued' | 'running';
  jobId: string | null;
  lastJudged: { at: number; model: string | null } | null;
  analyzerIds: string[];
}

/**
 * One `skills` entry
 * (`rest-envelope.schema.json#/$defs/SkillActionEntry`): an
 * operator-installed skill action offered on every node
 * (`spec/skill-actions.md` §HTTP surface). `id` is the `skill:<name>`
 * submit target the jobs route accepts verbatim; `name` / `description`
 * / `version` come from the boot-frozen catalog; `state` / `jobId` /
 * `lastJudged` mirror `IProbExtensionEntry` over the skill's own jobs.
 */
export interface ISkillActionLauncherEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  state: 'idle' | 'queued' | 'running';
  jobId: string | null;
  lastJudged: { at: number; model: string | null } | null;
}

/** The `item` payload of the `node.prob-extensions` single envelope. */
export interface IProbExtensionsCatalog {
  finders: IProbExtensionEntry[];
  standalone: IProbExtensionEntry[];
  issueFixers: IIssueFixerEntry[];
  skills: ISkillActionLauncherEntry[];
}

export function registerNodeProbExtensionsRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/nodes/:pathB64/prob-extensions', async (c) => {
    const nodePath = decodePathB64Or404(c.req.param('pathB64'));

    // Recompose the probabilistic catalogs per request against a fresh
    // resolver from the LIVE layered config so a mid-session toggle is
    // honoured without an `sm serve` restart (see the module header).
    const sources = await composeProbSources(deps);

    const item = await tryWithSqlite(
      { databasePath: deps.options.dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
      async (adapter) => {
        const bundle = await adapter.scans.findNode(nodePath);
        if (!bundle) return null;
        return buildCatalog(
          adapter,
          bundle.node,
          sources,
          offeredSkillActionCatalog(deps.skillActionCatalog, deps.runtimeContext.cwd),
        );
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

/**
 * Build the probabilistic catalog sources for one request. A fresh
 * enabled-resolver is derived from the live layered config
 * (`configService.effective()`) and threaded into `buildActionRuntime`
 * so a mid-session enable/disable is honoured without restarting
 * `sm serve` (audit M3: in-memory re-filter of the boot-cached runtime,
 * no discovery pass). The warn sink is a noop here, warnings already
 * went to the log once at server boot (`server/index.ts`, the single
 * emission point). See `core/runtime/fresh-resolver.ts`.
 */
async function composeProbSources(deps: IRouteDeps): Promise<ICatalogSources> {
  const resolveEnabled = await buildFreshResolver({
    effectiveConfig: () => deps.configService.effective(),
  });
  const runtime = buildActionRuntime(
    deps.pluginRuntimeHolder.current,
    () => {
      /* discard: warnings emitted once at server boot */
    },
    undefined,
    resolveEnabled,
  );
  // Locked = hidden SYSTEM extension (e.g. `core/ai-ping-action`, the
  // liveness probe): never a user-facing launcher affordance, the same way
  // it is hidden from MCP `list_extensions`. The platform enqueues it by id.
  const isVisibleProb = (a: IAnalyzer | IAction): boolean =>
    isProbabilistic(a) && !isLockedBuiltIn(qualifiedExtensionId(a.pluginId, a.id));
  const probAnalyzers = runtime.analyzers.filter(isVisibleProb);
  const probActions = runtime.actions.filter(isVisibleProb);
  // The composed probabilistic Actions projected to the minimal
  // `{ id, analyzerIds }` shape the shared inverse Modelo-B resolver
  // reads, mirroring the hook / record-path projection.
  const projectedActions: IFixerCandidateAction[] = probActions.map((a) => ({
    id: qualifiedExtensionId(a.pluginId, a.id),
    analyzerIds: a.precondition?.analyzerIds ?? [],
  }));
  return { probAnalyzers, probActions, projectedActions, runtime };
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
  skillCatalog: ISkillActionCatalog,
): Promise<IProbExtensionsCatalog> {
  // A virtual node has no backing file: nothing is launchable, the
  // submit route refuses it, so the catalog is honestly empty (skills
  // included: every skill takes the target FILE as its subject).
  if (node.virtual === true) {
    return { finders: [], standalone: [], issueFixers: [], skills: [] };
  }

  // ONE findings read (stale included, we filter staleness ourselves for
  // `hasOpenFindings`), ONE suppressions read (the read-time dismissal
  // lens: a dismissed class is NOT "open", the disabled state must agree
  // with the tray), and ONE jobs read for the whole
  // catalog; the per-entry decoration only touches `state_executions` for
  // the extensions that survived.
  const findings = await adapter.findings.list({ nodeId: node.path, includeStale: true });
  const suppressions =
    (await adapter.findings.suppressionsByPath([node.path])).get(node.path) ?? [];
  const activeJobs = (await adapter.jobs.list({ nodeId: node.path })).filter(
    (j) => j.status === 'queued' || j.status === 'running',
  );
  const maxSeverity = listedMaxSeverityByExtension(findings, suppressions);

  const finders: IProbExtensionEntry[] = [];
  const standalone: IProbExtensionEntry[] = [];
  const issueFixers: IIssueFixerEntry[] = [];

  for (const analyzer of sources.probAnalyzers) {
    if (!nodeMatchesPrecondition(node, analyzer.precondition)) continue;
    const qualified = qualifiedExtensionId(analyzer.pluginId, analyzer.id);
    const fixerIds = resolveMatchingFixerIds(qualified, sources.projectedActions);
    const findingsMaxSeverity = maxSeverity.get(qualified) ?? null;
    if (fixerIds.length > 0) {
      // A finder WITH a fixer: report its fixer(s) (the per-finding fix
      // button submits them) + whether open findings disable the button.
      finders.push(
        await buildEntry(adapter, node, analyzer, activeJobs, {
          fixerIds,
          hasOpenFindings: nodeHasOpenFindings(findings, suppressions, qualified),
          findingsMaxSeverity,
        }),
      );
    } else {
      // A finder WITHOUT a fixer stays a single Detect button: no fixer
      // to morph into, so `hasOpenFindings` is meaningless (always false).
      standalone.push(
        await buildEntry(adapter, node, analyzer, activeJobs, {
          fixerIds: [],
          hasOpenFindings: false,
          findingsMaxSeverity,
        }),
      );
    }
  }
  for (const action of sources.probActions) {
    const classified = await classifyProbAction(
      adapter,
      node,
      action,
      activeJobs,
      sources,
      maxSeverity,
    );
    pushClassifiedAction(classified, standalone, issueFixers);
  }

  const skills = await buildSkillsBucket(adapter, node, skillCatalog, activeJobs);

  return { finders, standalone, issueFixers, skills };
}

/**
 * The `skills` bucket: every catalog skill lands on every node,
 * deterministically (no precondition, no eligibility gate,
 * `spec/skill-actions.md` §HTTP surface); the catalog is already
 * name-sorted at discovery, so the bucket order is stable for free.
 */
async function buildSkillsBucket(
  adapter: StoragePort,
  node: Node,
  skillCatalog: ISkillActionCatalog,
  activeJobs: readonly Job[],
): Promise<ISkillActionLauncherEntry[]> {
  const skills: ISkillActionLauncherEntry[] = [];
  for (const skill of skillCatalog.entries) {
    skills.push(await buildSkillEntry(adapter, node, skill, activeJobs));
  }
  return skills;
}

/**
 * Highest severity per extension id among the rows the tray LISTS (the
 * verdict mark's source, spec §prob-extensions `findingsMaxSeverity`).
 * The mark's contract is that it agrees with what the operator is
 * looking at: severity while rows are listed, clean check once they are
 * all resolved. Both origins count (a run that surfaced a kernel safety
 * row left that row on the node too). One pass over the findings the
 * catalog already fetched; extensions with nothing listed stay absent.
 */
function listedMaxSeverityByExtension(
  findings: readonly IFindingRecord[],
  suppressions: readonly ISuppressionEntry[],
): Map<string, IFindingRecord['severity']> {
  const rank: Record<IFindingRecord['severity'], number> = { info: 0, warn: 1, error: 2 };
  const out = new Map<string, IFindingRecord['severity']>();
  for (const f of findings) {
    if (!isFindingListed(f, suppressions)) continue;
    const prev = out.get(f.extensionId);
    if (prev === undefined || rank[f.severity] > rank[prev]) out.set(f.extensionId, f.severity);
  }
  return out;
}

/**
 * Is this row LISTED in the findings tray's default view: not resolved
 * (`fixed` / `dismissed`, both of which move it to a hidden bucket) and
 * not hidden by the read-time class-suppression lens. A
 * `human-decision` row IS listed: the fixer handed the call to the
 * author, so it stays the node's TODO.
 *
 * STALE rows are listed too, marked inline (`db-schema.md`
 * §state_findings Stale rule: "a per-row annotation, not a hidden
 * bucket"), so they count here. That is load-bearing for the verdict
 * mark: a fixer's edit triggers a re-scan that turns every surviving
 * row of the node stale at once, and excluding them put a clean check
 * over a tray still full of visible findings.
 */
function isFindingListed(
  finding: IFindingRecord,
  suppressions: readonly ISuppressionEntry[],
): boolean {
  return (
    finding.resolution !== 'fixed' &&
    finding.resolution !== 'dismissed' &&
    !isFindingSuppressed(finding.extensionId, finding.type, suppressions)
  );
}

/** Land a classified action in its bucket (`null` = unlisted). */
function pushClassifiedAction(
  classified: TClassifiedProbAction | null,
  standalone: IProbExtensionEntry[],
  issueFixers: IIssueFixerEntry[],
): void {
  if (classified === null) return;
  if (classified.bucket === 'standalone') standalone.push(classified.entry);
  else issueFixers.push(toIssueFixerEntry(classified.entry, classified.analyzerIds));
}

/** `classifyProbAction`'s verdict: which bucket the action lands in. */
type TClassifiedProbAction =
  | { bucket: 'standalone'; entry: IProbExtensionEntry }
  | { bucket: 'issue-fixer'; entry: IProbExtensionEntry; analyzerIds: string[] };

/**
 * Classify one probabilistic Action against the node, or `null` when it
 * does not belong in the catalog:
 *
 *   - a fixer pairing a PROBABILISTIC finder (a non-empty `analyzerIds`
 *     resolving to a probabilistic analyzer) is UNLISTED: it is the second
 *     state of its finder's button, surfaced through the finder's `fixerIds`,
 *     never its own launcher.
 *   - a fixer of a DETERMINISTIC analyzer (`core/ai-reference-action` over
 *     `core/reference-broken`) lands in `issueFixers`, but ONLY when the
 *     node carries >= 1 Issue from those analyzerIds: the analyzer emits
 *     `scan_issues`, not `state_findings`, so there is no finder button to
 *     ride and nothing to fix without an open Issue. The UI renders it on
 *     the matching issue rows (user decision 2026-07-22), never as a
 *     launcher button.
 *   - an Action WITHOUT `analyzerIds` is a plain `standalone` launcher
 *     listed whenever its precondition matches the node (including the
 *     `frontmatterMissing` gap gate).
 */
async function classifyProbAction(
  adapter: StoragePort,
  node: Node,
  action: IAction,
  activeJobs: readonly Job[],
  sources: ICatalogSources,
  maxSeverity: ReadonlyMap<string, IFindingRecord['severity']>,
): Promise<TClassifiedProbAction | null> {
  const analyzerIds = fixerAnalyzerIds('action', action);
  const standaloneExtras = {
    fixerIds: [] as string[],
    hasOpenFindings: false,
    // A standalone action's run can still leave rows attributed to it
    // (the kernel safety lane stamps the REPORTING extension's id), so
    // its verdict mark rides the same map as the finders.
    findingsMaxSeverity:
      maxSeverity.get(qualifiedExtensionId(action.pluginId, action.id)) ?? null,
  };
  if (analyzerIds !== undefined) {
    if (referencedAnalyzerMode(sources.runtime.analyzers, analyzerIds) !== 'deterministic') {
      return null;
    }
    const issues = await adapter.issues.list({
      nodePath: node.path,
      analyzerIds,
      offset: 0,
      limit: 1,
    });
    if (issues.total === 0) return null;
    const entry = await buildEntry(adapter, node, action, activeJobs, standaloneExtras);
    return { bucket: 'issue-fixer', entry, analyzerIds: [...analyzerIds] };
  }
  if (!nodeMatchesPrecondition(node, action.precondition)) return null;
  const entry = await buildEntry(adapter, node, action, activeJobs, standaloneExtras);
  return { bucket: 'standalone', entry };
}

/**
 * Project a built launcher entry to the `issueFixers` wire shape:
 * drop the finder-only fields and attach the SHORT analyzer ids (plugin
 * prefix and `:sub-id` stripped from the action's declared
 * `precondition.analyzerIds`, matching how `scan_issues.analyzerId`
 * persists them), the key the UI matches issue rows against.
 */
function toIssueFixerEntry(
  entry: IProbExtensionEntry,
  declaredAnalyzerIds: readonly string[],
): IIssueFixerEntry {
  const shortIds = [...new Set(declaredAnalyzerIds.map(shortAnalyzerId))];
  return {
    id: entry.id,
    description: entry.description,
    state: entry.state,
    jobId: entry.jobId,
    lastJudged: entry.lastJudged,
    analyzerIds: shortIds,
  };
}

/** `core/reference-broken:sub` → `reference-broken` (the persisted issue id form). */
function shortAnalyzerId(qualified: string): string {
  const slash = qualified.indexOf('/');
  const bare = slash === -1 ? qualified : qualified.slice(slash + 1);
  const colon = bare.indexOf(':');
  return colon === -1 ? bare : bare.slice(0, colon);
}

/**
 * True when the node carries at least one UNRESOLVED (not `fixed`),
 * non-stale finding emitted by `finderQualifiedId`
 * (`rest-envelope.schema.json#/$defs/ProbExtensionEntry.hasOpenFindings`).
 * A `fixed` row is done (re-checkable), a stale row awaits a re-run, so
 * neither keeps the button disabled. `human-decision` rows count (they
 * are not `fixed`): the finder still surfaced something open.
 */
function nodeHasOpenFindings(
  findings: readonly IFindingRecord[],
  suppressions: readonly ISuppressionEntry[],
  finderQualifiedId: string,
): boolean {
  return findings.some(
    (f) =>
      // The finder lane only: the button morphs on the finder's OWN
      // judgment, never on a kernel safety row it merely surfaced.
      f.origin === 'extension' &&
      f.extensionId === finderQualifiedId &&
      // Row-grain dismissal (2026-07-22) and the class lens are shared
      // with the verdict mark; the extra `stale` gate is this button's
      // alone (a stale row awaits a RE-RUN, not a fix, so the button
      // must stay in its Detect state), which is exactly why the two
      // are separate predicates rather than one.
      isFindingListed(f, suppressions) &&
      f.stale === false,
  );
}

/** Base entry: id, description, live queue state + active job handle, last judgment, fixer fields. */
/**
 * Per-row fix busy (spec §prob-extensions `fixerBusy`): summarize the
 * ACTIVE fixer jobs' frozen finding targets. A whole-node job (null
 * `findingIds`) covers every row; subset jobs union their ids. `null`
 * when no fixer job is active.
 */
function computeFixerBusy(fixerJobs: readonly Job[]): IProbExtensionEntry['fixerBusy'] {
  if (fixerJobs.length === 0) return null;
  return {
    all: fixerJobs.some((j) => j.findingIds === null),
    findingIds: [...new Set(fixerJobs.flatMap((j) => j.findingIds ?? []))].sort((a, b) => a - b),
  };
}

/**
 * One `skills` entry: catalog identity + the live decoration `buildEntry`
 * gives an extension launcher, scoped to the SKILL's own jobs (a skill
 * has no fixer union to fold in). `running` wins over `queued`; the
 * exposed `jobId` is the row that decided the state (the cancel handle);
 * `lastJudged` is the latest COMPLETED execution for the (node, skill)
 * pair, read off `state_executions` by the frozen `skill:` id.
 */
async function buildSkillEntry(
  adapter: StoragePort,
  node: Node,
  skill: ISkillActionEntry,
  activeJobs: readonly Job[],
): Promise<ISkillActionLauncherEntry> {
  const mine = activeJobs.filter((j) => j.extensionId === skill.id);
  const runningJob = mine.find((j) => j.status === 'running');
  const activeJob = runningJob ?? mine[0];
  const state = runningJob !== undefined ? 'running' : mine.length > 0 ? 'queued' : 'idle';
  const [latest] = await adapter.history.list({
    nodePath: node.path,
    extensionId: skill.id,
    statuses: ['completed'],
    limit: 1,
  });
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    state,
    jobId: activeJob?.id ?? null,
    lastJudged: latest ? { at: latest.finishedAt, model: latest.model ?? null } : null,
  };
}

async function buildEntry(
  adapter: StoragePort,
  node: Node,
  extension: IAction | IAnalyzer,
  activeJobs: readonly Job[],
  extras: {
    fixerIds: string[];
    hasOpenFindings: boolean;
    findingsMaxSeverity: IFindingRecord['severity'] | null;
  },
): Promise<IProbExtensionEntry> {
  const qualified = qualifiedExtensionId(extension.pluginId, extension.id);
  // The BUTTON's active job is the finder's OR any of its fixers' (the
  // per-finding fix button submits the fixer, so a queued/running fixer
  // must light the finder button and the row's fix affordance). Union `{finder} ∪
  // fixerIds`; standalone entries have no fixerIds so this is just the
  // extension itself.
  const buttonIds = new Set<string>([qualified, ...extras.fixerIds]);
  const mine = activeJobs.filter((j) => buttonIds.has(j.extensionId));
  // `running` wins over `queued` when both exist (distinct content
  // hashes can hold one of each); an idle pair has no active row. The
  // exposed `jobId` is the row that DECIDED the state (the running one
  // when it wins), so the cancel handle always targets the job the
  // launcher is visibly showing.
  const runningJob = mine.find((j) => j.status === 'running');
  const activeJob = runningJob ?? mine[0];
  const state = runningJob !== undefined ? 'running' : mine.length > 0 ? 'queued' : 'idle';
  const fixerBusy = computeFixerBusy(mine.filter((j) => j.extensionId !== qualified));
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
    findingsMaxSeverity: extras.findingsMaxSeverity,
    fixerBusy,
  };
}
