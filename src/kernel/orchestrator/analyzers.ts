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
import type { Issue, Link, Node, Severity } from '../types.js';
import type { IRegisteredAnnotationKey } from '../types/annotation-catalog.js';
import type { IRegisteredViewContribution } from '../types/view-catalog.js';
import { tx } from '../util/tx.js';
import { emitExtensionError, readDeclaredContributions } from './extractors.js';

/**
 * Run every registered analyzer over the merged graph. Analyzers see internal
 * links only — broken-ref / trigger-collision / superseded all reason
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
  emitter: ProgressEmitterPort,
  hookDispatcher: IHookDispatcher,
): Promise<{ issues: Issue[]; contributions: IContributionRecord[] }> {
  const issues: Issue[] = [];
  const contributions: IContributionRecord[] = [];
  const validators = loadSchemaValidators();
  // Project the kernel-internal `IOrphanSidecar` shape to the analyzer-
  // facing `IAnalyzerOrphanSidecar`: analyzers don't need the absolute
  // `.sm` path, just the relative path + the expected `.md`.
  const analyzerOrphans = orphanSidecars.map((o) => ({
    relativePath: o.relativePath,
    expectedMdPath: o.expectedMdPath,
  }));
  for (const analyzer of analyzers) {
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
      ...(referenceablePaths ? { referenceablePaths } : {}),
      ...(cwd ? { cwd } : {}),
      emitContribution,
    });
    for (const issue of emitted) {
      const validated = validateIssue(analyzer, issue, emitter);
      if (validated) issues.push(validated);
    }
    // Spec § A.11 — `analyzer.completed`. Aggregated per Analyzer, after every
    // issue has been validated. Fan-out scope: one event per Analyzer per
    // scan. The payload carries the qualified analyzer id so a hook with
    // `filter: { analyzerId: '...' }` can scope to a single analyzer.
    const evt = makeEvent('analyzer.completed', { analyzerId: qualifiedId });
    emitter.emit(evt);
    await hookDispatcher.dispatch('analyzer.completed', evt);
  }
  return { issues, contributions };
}

function validateIssue(analyzer: IAnalyzer, issue: Issue, emitter: ProgressEmitterPort): Issue | null {
  const severity: Severity | undefined = issue.severity;
  if (severity !== 'error' && severity !== 'warn' && severity !== 'info') {
    // Analyzer emitted an out-of-spec severity (or none at all) — drop the
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
