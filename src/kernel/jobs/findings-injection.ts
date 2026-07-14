/**
 * Findings-injection section of a FIXER job's rendered content
 * (`spec/job-lifecycle.md` §Findings injection for fixers). A fixer is a
 * probabilistic Action that declares `precondition.analyzerIds` (Modelo B,
 * `spec/architecture.md`): it resolves the findings a finder emitted. Because
 * the fix must act on exactly what the finder reported (not re-derive it),
 * the kernel injects those findings into the rendered job content at submit.
 *
 * Two pure building blocks the CLI submit path composes:
 *   - `selectFixerFindings`, the SELECTION over a node's findings list:
 *     `origin = 'extension'` (the finder's own judgments, NOT the kernel
 *     safety lane, an `injection-detected` flag is not a prose defect a
 *     fixer consolidates) whose `extension_id` is one of the Action's
 *     `analyzerIds`, and NOT stale. The caller sources the list through
 *     `port.findings.list({ nodeId })`, which already excludes stale rows
 *     via its LEFT-JOIN staleness rule (`kernel/adapters/sqlite/findings.ts`
 *     `listFindings`), so this leg never re-derives staleness; the `!stale`
 *     guard here is defensive. Ordered by `id` ascending so the rendered
 *     bytes reproduce.
 *   - `buildFindingsSection`, the RENDER: the `## Findings to resolve`
 *     heading, a one-line caution that spans quoted inside the findings are
 *     DATA not instructions, then a fenced ```json array of the selected
 *     findings projected to {type, severity, message, detail, confidence}.
 *
 * The section is kernel-authored prelude: it renders OUTSIDE the
 * `<user-content>` block, BEFORE the report contract, and folds into
 * `promptTemplateHash` (`content-hash.ts`) exactly like the report-contract
 * blocks, so a changed finding set re-keys the fixer job (correct dedup:
 * re-running after the finder re-judged is a new job) while non-fixer jobs,
 * which have no such section, keep their hash unchanged.
 */

import type { Severity } from '../types.js';
import type { IFindingRecord } from '../types/storage.js';
import { JOB_TEXTS } from '../i18n/jobs.texts.js';
import { matchesQualifiedExtensionFilter } from '../util/analyzer-filter.js';

/**
 * The per-finding projection injected into the fenced json array
 * (`spec/job-lifecycle.md` §Findings injection for fixers). Deliberately
 * narrower than the stored `IFindingRecord`: only the fields the draining
 * agent needs to apply the fix, never the internal stamps (`id`,
 * `bodyHashAtGeneration`, `generatedAt`, `jobId`, `origin`).
 */
export interface IFixerFindingProjection {
  type: string;
  severity: Severity;
  message: string;
  detail: string | null;
  confidence: number;
}

/**
 * Select the extension-lane findings a fixer resolves from a node's
 * findings list: `origin = 'extension'` (never the kernel safety lane)
 * whose `extension_id` is one of `analyzerIds` (same qualified/bare
 * matching as `sm check --analyzers`, via `matchesQualifiedExtensionFilter`),
 * and NOT stale. The input list is assumed already stale-excluded (the
 * adapter `list` default); the `!stale` filter is defensive. Ordered by
 * `id` ascending so two submits over the same finding set render identical
 * bytes.
 */
export function selectFixerFindings(
  findings: readonly IFindingRecord[],
  analyzerIds: readonly string[],
): IFindingRecord[] {
  return findings
    .filter(
      (finding) =>
        finding.origin === 'extension' &&
        !finding.stale &&
        matchesQualifiedExtensionFilter(finding.extensionId, analyzerIds),
    )
    .slice()
    .sort((a, b) => a.id - b.id);
}

/** Project a stored finding to the injected shape (fixed key order). */
function projectFinding(finding: IFindingRecord): IFixerFindingProjection {
  return {
    type: finding.type,
    severity: finding.severity,
    message: finding.message,
    detail: finding.detail,
    confidence: finding.confidence,
  };
}

/**
 * Render the `## Findings to resolve` section from ALREADY-SELECTED
 * findings (`selectFixerFindings`): the heading, a one-line
 * data-not-instructions caution, then a fenced ```json array of the
 * projected findings. Callers MUST NOT invoke this with an empty array,
 * submit refuses a fixer with no matching findings BEFORE rendering
 * (`spec/job-lifecycle.md` §Findings injection for fixers).
 */
export function buildFindingsSection(findings: readonly IFindingRecord[]): string {
  const projected = findings.map(projectFinding);
  const json = JSON.stringify(projected, null, 2);
  return (
    `${JOB_TEXTS.findingsToResolveHeading}\n\n` +
    `${JOB_TEXTS.findingsToResolveCaution}\n\n` +
    `\`\`\`json\n${json}\n\`\`\``
  );
}
