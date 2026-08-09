/**
 * Analyzer pass: runs every registered analyzer over the merged graph
 * after the walk completes. Mirrors the Extractor emit-time wiring for
 * `ctx.emitContribution` so analyzer-emitted view contributions
 * survive AJV validation against their slot's payload schema before
 * landing in `scan_contributions`.
 *
 * Issue validation (`validateIssue`) catches analyzers that emit an
 * out-of-spec `severity` and surfaces them as `extension.error` events
 * so plugin authors see why an issue silently disappeared.
 *
 * The same emit-side gate enforces the operator's standing dismissals
 * (`annotations.issueSuppressions`, `spec/db-schema.md` §scan_issues):
 * an issue carrying a `data.target` is DROPPED when any of its
 * `nodeIds` holds a matching (analyzer, value) entry. It lives here,
 * not in each analyzer, because the dismiss affordance is offered
 * generically for any value-carrying issue (UI button, `sm issues
 * dismiss`, the MCP tool), so honouring it must be generic too:
 * otherwise every analyzer that forgets the check, and every
 * third-party one, ships a dismiss that silently comes back on the
 * next scan. An analyzer still consults the entries itself when the
 * dismissal must ALSO skip a side effect this drop cannot undo (today
 * only `core/reference-broken`'s confidence penalty).
 */

import {
  makeEvent,
  type IHookDispatcher,
} from '../extensions/hook-dispatcher.js';
import type { IAnalyzer, INameClaim, INameMismatch } from '../extensions/index.js';
import { loadSchemaValidators } from '../adapters/schema-validators.js';
import type {
  IContributionErrorRecord,
  IContributionRecord,
} from '../adapters/sqlite/contributions.js';
import { ORCHESTRATOR_TEXTS } from '../i18n/orchestrator.texts.js';
import type {
  ProgressEmitterPort,
} from '../ports/progress-emitter.js';
import type { IOrphanSidecar } from '../sidecar/index.js';
import { qualifiedExtensionId } from '../registry.js';
import type { Issue, Link, Node, Severity, Signal, TConfidenceOp } from '../types.js';
import { applyConfidenceAdjustments, type IConfidenceAdjustment } from './confidence-score.js';
import type { IRegisteredAnnotationKey } from '../types/annotation-catalog.js';
import type { IRegisteredViewContribution, IViewContribution } from '../types/view-catalog.js';
import { makeExtensionLogger } from '../util/extension-logger.js';
import {
  buildIssueSuppressionIndex,
  isIssueSuppressed,
  type IIssueSuppressionEntry,
} from '../util/issue-suppressions.js';
import { tx } from '../util/tx.js';
import { emitExtensionError, readDeclaredContributionRefs } from './extractors.js';

/**
 * Run every registered analyzer over the merged graph. Analyzers see internal
 * links only, broken-ref / name-collision all reason about graph
 * relations, not URLs.
 *
 * Analyzers MAY emit per-node view contributions via
 * `ctx.emitContribution(nodePath, contributionId, payload)`. The
 * orchestrator validates each emission against the slot's payload
 * schema (mirror of the Extractor emit path) and silently drops
 * invalid emissions with an `extension.error` event. Accepted
 * emissions land on the returned `contributions[]` and reach
 * `scan_contributions` via the same persistence pipeline as
 * Extractor-emitted contributions.
 */
// eslint-disable-next-line complexity
export async function runAnalyzers(
  analyzers: IAnalyzer[],
  nodes: Node[],
  internalLinks: Link[],
  orphanSidecars: IOrphanSidecar[],
  sidecarRoots: ReadonlyMap<string, Record<string, unknown>>,
  annotationContributions: readonly IRegisteredAnnotationKey[],
  viewContributions: readonly IRegisteredViewContribution[],
  referenceablePaths: ReadonlySet<string> | undefined,
  cwd: string | undefined,
  registeredActionIds: ReadonlySet<string>,
  emitter: ProgressEmitterPort,
  hookDispatcher: IHookDispatcher,
  reservedNodePaths: ReadonlySet<string> | undefined,
  brokenLinks: ReadonlySet<Link> | undefined,
  nameCollisions: ReadonlyMap<string, readonly INameClaim[]> | undefined,
  signals: readonly Signal[] | undefined,
  nameMismatches: readonly INameMismatch[] | undefined,
  // Pre-analyzer issues (e.g. orchestrator-side
  // `frontmatter-parse-error` / `frontmatter-invalid`) seeded into the
  // accumulator so the aggregate phase (`core/issue-counter`) counts
  // them too. Excluded from the return so the caller's merge logic
  // does not double-count.
  seedIssues: readonly Issue[] = [],
): Promise<{
  issues: Issue[];
  contributions: IContributionRecord[];
  contributionErrors: IContributionErrorRecord[];
  // Attributed confidence adjustments buffered by `score`-phase analyzers
  // and folded into `link.confidence`. Returned so the persistence layer
  // can write the `scan_link_scores` audit trail ("why is this link at
  // X?"). The fold already happened; these are the per-op attribution.
  linkScores: IConfidenceAdjustment[];
}> {
  const issues: Issue[] = [...seedIssues];
  const contributions: IContributionRecord[] = [];
  // "off-shape visible" follow-up, analyzer-side buffer of rejected
  // emissions. Same shape + persistence path as the extractor buffer.
  const contributionErrors: IContributionErrorRecord[] = [];
  const validators = loadSchemaValidators();
  // Recommended-actions validation lived here; the relationship is now
  // declared from the Action side via `precondition.analyzerIds` (Modelo B),
  // see `kernel/extensions/action.ts`. The orphan-action diagnostic for
  // Modelo B lives in `sm plugins doctor`, not in scan-time hot path.
  void registeredActionIds;
  // Project the kernel-internal `IOrphanSidecar` shape to the analyzer-
  // facing `IAnalyzerOrphanSidecar`: analyzers don't need the absolute
  // `.sm` path, just the relative path + the expected `.md`.
  const analyzerOrphans = orphanSidecars.map((o) => ({
    relativePath: o.relativePath,
    expectedMdPath: o.expectedMdPath,
  }));
  // Two-phase schedule: `detect` analyzers run first and populate the
  // issue accumulator; `aggregate` analyzers run strictly afterwards
  // with the full accumulator visible on `ctx.accumulatedIssues`.
  // Filesystem-sorted generators (scripts/generate-built-ins.js) keep
  // emitting alphabetical orders, the orchestrator imposes the run
  // sequence at execution time.
  //
  // Probabilistic analyzers (finders) NEVER enter a scan-time phase
  // (`spec/architecture.md` §Analyzer phases): they have no `evaluate()`
  // (the judgment is a queued job an external agent processes via
  // `sm jobs submit` + `sm record`), so the schedule drops them here.
  const scheduled = orderAnalyzersByPhase(
    analyzers.filter((a) => (a.mode ?? 'deterministic') !== 'probabilistic'),
  );
  // `score`-phase analyzers (scheduled first) buffer attributed confidence
  // ops; the orchestrator folds them into `link.confidence` ONCE, before
  // the read-only `detect` phase, so detect analyzers (e.g.
  // `core/name-reserved`, keyed on `confidence === 0.1`) read the final
  // value. Links matched by object identity.
  // Operator dismissals, indexed once for the whole pass (empty map in
  // the overwhelmingly common project with no `.sm` suppressions).
  const suppressions = buildIssueSuppressionIndex(nodes, sidecarRoots);
  const scoreAdjustments: IConfidenceAdjustment[] = [];
  const scorableLinks = new Set<Link>(internalLinks);
  let scoresFolded = false;
  const foldScores = (): void => {
    if (scoresFolded) return;
    scoresFolded = true;
    applyConfidenceAdjustments(scoreAdjustments);
  };
  for (const analyzer of scheduled) {
    // Barrier: fold score ops before the first non-`score` analyzer.
    if (analyzer.phase !== 'score') foldScores();
    const qualifiedId = qualifiedExtensionId(analyzer.pluginId, analyzer.id);
    const declaredContributions = readDeclaredContributionRefs(analyzer);
    const emitContribution = (
      nodePath: string,
      ref: IViewContribution,
      payload: unknown,
    ): void => {
      const declared =
        typeof ref === 'object' && ref !== null ? declaredContributions.get(ref) : undefined;
      if (!declared) {
        const message = tx(ORCHESTRATOR_TEXTS.extensionErrorContributionUndeclaredRef, {
          extractorId: qualifiedId,
          nodePath,
        });
        emitExtensionError(emitter, qualifiedId, nodePath, {
          phase: 'emitContribution',
          reason: 'undeclared-contribution-ref',
          message,
        });
        contributionErrors.push({
          pluginId: analyzer.pluginId,
          extensionId: analyzer.id,
          nodePath,
          reason: 'undeclared-contribution-ref',
          message,
          emittedAt: Date.now(),
        });
        return;
      }
      const result = validators.validateContributionPayload(declared.slot, payload);
      if (!result.ok) {
        const message = tx(ORCHESTRATOR_TEXTS.extensionErrorContributionPayloadInvalid, {
          extractorId: qualifiedId,
          contributionId: declared.id,
          nodePath,
          slot: declared.slot,
          errors: result.errors,
        });
        emitExtensionError(emitter, qualifiedId, nodePath, {
          phase: 'emitContribution',
          contributionId: declared.id,
          slot: declared.slot,
          reason: result.errors,
          message,
        });
        contributionErrors.push({
          pluginId: analyzer.pluginId,
          extensionId: analyzer.id,
          nodePath,
          reason: result.errors,
          message,
          contributionId: declared.id,
          slot: declared.slot,
          emittedAt: Date.now(),
        });
        return;
      }
      contributions.push({
        pluginId: analyzer.pluginId,
        extensionId: analyzer.id,
        nodePath,
        contributionId: declared.id,
        slot: declared.slot,
        payload,
        emittedAt: Date.now(),
      });
    };
    // Only `score`-phase analyzers may write confidence. Buffer their
    // attributed ops by link object identity; `foldScores` applies them.
    const adjustConfidence =
      analyzer.phase === 'score'
        ? (link: Link, op: TConfidenceOp): void => {
            if (scorableLinks.has(link)) {
              scoreAdjustments.push({
                link,
                pluginId: analyzer.pluginId,
                extensionId: analyzer.id,
                op,
              });
            }
            // A link not in the merged graph is ignored (a third-party
            // diagnostic lands with the score-phase external surface).
          }
        : undefined;
    // `evaluate` is conditional per mode on the contract; the schedule
    // above already dropped probabilistic analyzers, so a missing
    // `evaluate` here is a stub deterministic analyzer, treated as an
    // empty emission rather than a crash.
    const emitted = (await analyzer.evaluate?.({
      nodes,
      links: internalLinks,
      // `settings` is always populated (possibly empty) so analyzers can
      // read `ctx.settings.<id>` without a presence check. The composer
      // populated `resolvedSettings` on each composed analyzer.
      settings: analyzer.resolvedSettings ?? {},
      orphanSidecars: analyzerOrphans,
      sidecarRoots,
      annotationContributions,
      viewContributions,
      // `issues` is the live accumulator, mutated by `issues.push(...)`
      // below as each analyzer's emission lands. Late-phase analyzers
      // (`core/issue-counter`) read it to compute cross-analyzer
      // aggregates. Treat as read-only on the analyzer side.
      accumulatedIssues: issues,
      log: makeExtensionLogger(qualifiedId),
      ...(referenceablePaths ? { referenceablePaths } : {}),
      ...(cwd ? { cwd } : {}),
      ...(reservedNodePaths ? { reservedNodePaths } : {}),
      ...(brokenLinks ? { brokenLinks } : {}),
      ...(nameCollisions && nameCollisions.size > 0 ? { nameCollisions } : {}),
      ...(nameMismatches && nameMismatches.length > 0 ? { nameMismatches } : {}),
      ...(signals && signals.length > 0 ? { signals } : {}),
      ...(adjustConfidence ? { adjustConfidence } : {}),
      emitContribution,
    })) ?? [];
    for (const issue of emitted) {
      const validated = validateIssue(analyzer, issue, emitter);
      if (!validated) continue;
      if (isDismissedByOperator(qualifiedId, validated, suppressions)) continue;
      issues.push(validated);
    }
    // Spec § A.11, `analyzer.completed`. Aggregated per Analyzer, after every
    // issue has been validated. Fan-out scope: one event per Analyzer per
    // scan. The payload carries the qualified analyzer id so a hook with
    // `filter: { analyzerId: '...' }` can scope to a single analyzer.
    const evt = makeEvent('analyzer.completed', { analyzerId: qualifiedId });
    emitter.emit(evt);
    await hookDispatcher.dispatch('analyzer.completed', evt);
  }
  // Fold once more in case the schedule held only `score` analyzers (no
  // later phase triggered the barrier above).
  foldScores();
  // `scoreAdjustments` carries one entry per attributed `adjustConfidence`
  // call; by here the fold has written the final value into each
  // `adj.link.confidence`, so the buffer doubles as the audit trail the
  // persistence layer mirrors into `scan_link_scores`.
  return { issues, contributions, contributionErrors, linkScores: scoreAdjustments };
}

/**
 * Order analyzers so every `detect` runs before any `aggregate`. The
 * input order is preserved within each phase (filesystem-sorted by
 * the generator), the only contract is the phase boundary itself,
 * `aggregate` analyzers see a complete `accumulatedIssues` array.
 *
 * Stable sort is critical here, the per-phase order is deterministic
 * input from the generator and downstream tests pin against it.
 * `Array.prototype.sort` is stable on Node 12+ so the natural sort
 * with a phase comparator preserves the inner ordering.
 */
function orderAnalyzersByPhase(analyzers: IAnalyzer[]): IAnalyzer[] {
  return analyzers.slice().sort((a, b) => phaseRank(a) - phaseRank(b));
}

function phaseRank(a: IAnalyzer): number {
  if (a.phase === 'score') return 0;
  if (a.phase === 'aggregate') return 2;
  return 1; // 'detect' (default)
}

/**
 * The operator-dismissal gate: an issue is dropped when it carries a
 * non-empty string `data.target` and ANY node it is anchored to holds a
 * matching `annotations.issueSuppressions` entry. Anchoring is
 * any-of, not first-of, on purpose: a multi-node issue renders under
 * every node in `nodeIds`, and `sm issues dismiss` deletes the whole
 * persisted row from whichever node the operator dismissed it on, so
 * the emission-time gate mirrors that reach.
 *
 * Issues without a `data.target` carry no dismissal key at all (the UI
 * renders no dismiss button for them) and always pass.
 */
function isDismissedByOperator(
  qualifiedAnalyzerId: string,
  issue: Issue,
  suppressions: ReadonlyMap<string, IIssueSuppressionEntry[]>,
): boolean {
  if (suppressions.size === 0) return false;
  const target = issue.data?.['target'];
  if (typeof target !== 'string' || target === '') return false;
  return issue.nodeIds.some((nodeId) => {
    const entries = suppressions.get(nodeId);
    return entries !== undefined && isIssueSuppressed(qualifiedAnalyzerId, target, entries);
  });
}

function validateIssue(analyzer: IAnalyzer, issue: Issue, emitter: ProgressEmitterPort): Issue | null {
  const severity: Severity | undefined = issue.severity;
  if (severity !== 'error' && severity !== 'warn' && severity !== 'info') {
    // Analyzer emitted an out-of-spec severity (or none at all), drop the
    // issue. Surface a diagnostic so plugin authors see the issue
    // disappear FOR A REASON, instead of silently never showing up.
    // Qualified id (spec § A.6) keeps `extension.error` consumers
    // unambiguous across plugin namespaces.
    const qualifiedId = `${analyzer.pluginId}/${analyzer.id}`;
    emitter.emit(
      makeEvent('extension.error', {
        kind: 'issue-invalid-severity',
        extensionId: qualifiedId,
        severity,
        issue: { analyzerId: issue.analyzerId || analyzer.id, message: issue.message, nodeIds: issue.nodeIds },
        message: tx(ORCHESTRATOR_TEXTS.extensionErrorIssueInvalidSeverity, {
          analyzerId: qualifiedId,
          severity: JSON.stringify(severity),
        }),
      }),
    );
    return null;
  }
  return { ...issue, analyzerId: issue.analyzerId || analyzer.id };
}
