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
 *     `analyzerIds`. Stale rows are INCLUDED, flagged, not filtered:
 *     staleness is node-level (any body byte invalidates every finding on
 *     the node), so fixing one section stales the findings about untouched
 *     sections whose defects are still verbatim present; dropping them
 *     would discard valid judgments and force a re-detection between every
 *     fix. The caller sources the list through
 *     `port.findings.list({ nodeId, includeStale: true })`, since the
 *     adapter hides stale rows by default. Ordered by `id` ascending so the
 *     rendered bytes reproduce.
 *   - `buildFindingsSection`, the RENDER: the `## Findings to resolve`
 *     heading, a one-line caution that spans quoted inside the findings are
 *     DATA not instructions, then a fenced ```json array of the selected
 *     findings projected to {id, type, severity, message, detail,
 *     confidence, stale}. The `id` leads: it is what the fixer echoes back
 *     in its report's `resolved[]` so the kernel can stamp each finding's
 *     resolution at record (`spec/db-schema.md` §state_findings). `stale`
 *     closes the shape: the fixer template instructs the agent to verify a
 *     flagged entry against the current body and decline what no longer
 *     applies.
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
 * narrower than the stored `IFindingRecord`: only the fields the processing
 * agent needs to apply the fix, never the internal stamps
 * (`bodyHashAtGeneration`, `generatedAt`, `jobId`, `origin`).
 *
 * `id` is the exception and leads the shape: the fixer copies it verbatim
 * into its report's `resolved[]` so the record path can stamp the
 * resolution back onto THIS row (`spec/db-schema.md` §state_findings).
 * Without it the fixer's outcome could not be tied to the finding it
 * addressed.
 *
 * `stale` closes it: `true` means the finding was judged against an earlier
 * version of the body, so the agent MUST verify it against the current
 * content before acting and decline it when it no longer applies. It is
 * derived at read time (`kernel/adapters/sqlite/findings.ts` `listFindings`),
 * never a stored column.
 */
export interface IFixerFindingProjection {
  id: number;
  type: string;
  severity: Severity;
  message: string;
  detail: string | null;
  confidence: number;
  stale: boolean;
}

/**
 * Select the extension-lane findings a fixer resolves from a node's
 * findings list: `origin = 'extension'` (never the kernel safety lane)
 * whose `extension_id` is one of `analyzerIds` (same qualified/bare
 * matching as `sm check --analyzers`, via `matchesQualifiedExtensionFilter`).
 * Fresh AND stale rows both survive (the stale ones ride flagged, see
 * `projectFinding`): staleness is node-level, so a fix in one section
 * stales every finding on the node including the untouched sections' still
 * verbatim present defects, and filtering here would break the natural
 * "queue all the fixers" flow. Callers MUST source the list with
 * `includeStale: true` or the adapter hides the stale rows before this leg
 * sees them. Ordered by `id` ascending so two submits over the same finding
 * set render identical bytes.
 */
export function selectFixerFindings(
  findings: readonly IFindingRecord[],
  analyzerIds: readonly string[],
): IFindingRecord[] {
  return findings
    .filter(
      (finding) =>
        finding.origin === 'extension' &&
        matchesQualifiedExtensionFilter(finding.extensionId, analyzerIds),
    )
    .slice()
    .sort((a, b) => a.id - b.id);
}

/** Project a stored finding to the injected shape (fixed key order). */
function projectFinding(finding: IFindingRecord): IFixerFindingProjection {
  return {
    id: finding.id,
    type: finding.type,
    severity: finding.severity,
    message: finding.message,
    detail: finding.detail,
    confidence: finding.confidence,
    stale: finding.stale,
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
