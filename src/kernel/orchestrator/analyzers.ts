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
 */

import {
  makeEvent,
  type IHookDispatcher,
} from '../extensions/hook-dispatcher.js';
import type { IAnalyzer } from '../extensions/index.js';
import { loadSchemaValidators } from '../adapters/schema-validators.js';
import type { IContributionRecord } from '../adapters/sqlite/contributions.js';
import { ORCHESTRATOR_TEXTS } from '../i18n/orchestrator.texts.js';
import type {
  ProgressEmitterPort,
} from '../ports/progress-emitter.js';
import type { IOrphanSidecar } from '../sidecar/index.js';
import { qualifiedExtensionId } from '../registry.js';
import type { Issue, Link, Node, Severity, Signal } from '../types.js';
import type { IRegisteredAnnotationKey } from '../types/annotation-catalog.js';
import type { IRegisteredViewContribution } from '../types/view-catalog.js';
import { tx } from '../util/tx.js';
import { emitExtensionError, readDeclaredContributions } from './extractors.js';

/**
 * Run every registered analyzer over the merged graph. Analyzers see internal
 * links only, broken-ref / trigger-collision / superseded all reason
 * about graph relations, not URLs.
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
  orphanJobFiles: readonly string[],
  referenceablePaths: ReadonlySet<string> | undefined,
  cwd: string | undefined,
  registeredActionIds: ReadonlySet<string>,
  emitter: ProgressEmitterPort,
  hookDispatcher: IHookDispatcher,
  reservedNodePaths: ReadonlySet<string> | undefined,
  signals: readonly Signal[] | undefined,
  // Pre-analyzer issues (e.g. orchestrator-side
  // `frontmatter-parse-error` / `frontmatter-invalid`) seeded into the
  // accumulator so the aggregate phase (`core/issue-counter`) counts
  // them too. Excluded from the return so the caller's merge logic
  // does not double-count.
  seedIssues: readonly Issue[] = [],
): Promise<{ issues: Issue[]; contributions: IContributionRecord[] }> {
  const issues: Issue[] = [...seedIssues];
  const contributions: IContributionRecord[] = [];
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
  const scheduled = orderAnalyzersByPhase(analyzers);
  for (const analyzer of scheduled) {
    const qualifiedId = qualifiedExtensionId(analyzer.pluginId, analyzer.id);
    const declaredContributions = readDeclaredContributions(analyzer);
    const emitContribution = (
      nodePath: string,
      contributionId: string,
      payload: unknown,
    ): void => {
      const declared = declaredContributions.get(contributionId);
      if (!declared) {
        emitExtensionError(emitter, qualifiedId, nodePath, {
          phase: 'emitContribution',
          contributionId,
          reason: 'unknown-contribution-id',
          message: tx(ORCHESTRATOR_TEXTS.extensionErrorContributionUnknownId, {
            extractorId: qualifiedId,
            contributionId,
            nodePath,
          }),
        });
        return;
      }
      const result = validators.validateContributionPayload(declared.slot, payload);
      if (!result.ok) {
        emitExtensionError(emitter, qualifiedId, nodePath, {
          phase: 'emitContribution',
          contributionId,
          slot: declared.slot,
          reason: result.errors,
          message: tx(ORCHESTRATOR_TEXTS.extensionErrorContributionPayloadInvalid, {
            extractorId: qualifiedId,
            contributionId,
            nodePath,
            slot: declared.slot,
            errors: result.errors,
          }),
        });
        return;
      }
      contributions.push({
        pluginId: analyzer.pluginId,
        extensionId: analyzer.id,
        nodePath,
        contributionId,
        slot: declared.slot,
        payload,
        emittedAt: Date.now(),
      });
    };
    const emitted = await analyzer.evaluate({
      nodes,
      links: internalLinks,
      orphanSidecars: analyzerOrphans,
      sidecarRoots,
      annotationContributions,
      viewContributions,
      orphanJobFiles,
      // `issues` is the live accumulator, mutated by `issues.push(...)`
      // below as each analyzer's emission lands. Late-phase analyzers
      // (`core/issue-counter`) read it to compute cross-analyzer
      // aggregates. Treat as read-only on the analyzer side.
      accumulatedIssues: issues,
      ...(referenceablePaths ? { referenceablePaths } : {}),
      ...(cwd ? { cwd } : {}),
      ...(reservedNodePaths ? { reservedNodePaths } : {}),
      ...(signals && signals.length > 0 ? { signals } : {}),
      emitContribution,
    });
    for (const issue of emitted) {
      const validated = validateIssue(analyzer, issue, emitter);
      if (validated) issues.push(validated);
    }
    // Spec § A.11, `analyzer.completed`. Aggregated per Analyzer, after every
    // issue has been validated. Fan-out scope: one event per Analyzer per
    // scan. The payload carries the qualified analyzer id so a hook with
    // `filter: { analyzerId: '...' }` can scope to a single analyzer.
    const evt = makeEvent('analyzer.completed', { analyzerId: qualifiedId });
    emitter.emit(evt);
    await hookDispatcher.dispatch('analyzer.completed', evt);
  }
  return { issues, contributions };
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
  return a.phase === 'aggregate' ? 1 : 0;
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
