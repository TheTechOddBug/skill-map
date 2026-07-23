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

import type { Issue, Severity } from '../types.js';
import type { IFindingRecord } from '../types/storage.js';
import { JOB_TEXTS } from '../i18n/jobs.texts.js';
import { matchesAnalyzerFilter, matchesQualifiedExtensionFilter } from '../util/analyzer-filter.js';

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
 * "queue all the fixers" flow. RESOLVED rows do NOT survive
 * (`resolution IS NULL` only, spec §Selection): a `fixed` row is done
 * pending the finder's re-judgement and a `human-decision` row awaits the
 * author, so re-injecting either would re-propose decided work (and kept
 * the fixer launcher counting findings the operator already closed).
 * Callers MUST source the list with `includeStale: true` or the adapter
 * hides the stale rows before this leg sees them. Ordered by `id`
 * ascending so two submits over the same finding set render identical
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
        finding.resolution === null &&
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

// ---------------------------------------------------------------------------
// Deterministic-analyzer fixer: ISSUE injection (Modelo B, deterministic side)
// ---------------------------------------------------------------------------

/**
 * The per-issue projection injected into the `## Issues to resolve` json
 * array (`spec/job-lifecycle.md` §Findings injection for fixers, the
 * deterministic case). A deterministic analyzer's trigger is its
 * `scan_issues` rows, which carry NO stable id (the `scan_issues.id` is a
 * per-scan autoincrement wiped by replace-all), so unlike
 * `IFixerFindingProjection` there is no `id` for the fixer to echo back: the
 * report keys each entry on the broken `target` string instead, and the
 * fix's evidence is the next scan clearing the Issue (nothing is stamped).
 *
 * `target` + `kind` come from the Issue's `data` payload (for
 * `core/reference-broken` that is `{ target, kind, trigger }`); `severity` +
 * `message` come off the Issue itself. `null` when the payload omits the
 * field (defensive: a third-party deterministic analyzer might not populate
 * `data`).
 */
export interface IFixerIssueProjection {
  target: string | null;
  kind: string | null;
  severity: Severity;
  message: string;
}

/**
 * Select the Issues a fixer resolves from a node's `scan_issues` list: those
 * whose SHORT `analyzerId` matches one of the Action's (qualified or bare)
 * `analyzerIds`. Uses `matchesAnalyzerFilter` (short-stored / qualified-or-
 * bare-filter direction), NOT `matchesQualifiedExtensionFilter`, because
 * `scan_issues.analyzer_id` is stored SHORT (`reference-broken`) while a
 * fixer's `precondition.analyzerIds` are qualified (`core/reference-broken`).
 *
 * Issues have NO `resolution` / `origin` / `stale` axes (they are re-derived
 * every scan and are always "open" while present), so there is nothing to
 * filter on those, the selection is purely the analyzer-id match. Sorted
 * stably by `nodeIds[0]` then the projected `target` then `message` so two
 * submits over the same Issue set render byte-identical content (the same
 * reproducibility `selectFixerFindings` gets from its `id` ordering).
 */
export function selectFixerIssues(
  issues: readonly Issue[],
  analyzerIds: readonly string[],
): Issue[] {
  return issues
    .filter((issue) => matchesAnalyzerFilter(issue.analyzerId, analyzerIds))
    .slice()
    .sort(compareIssuesForInjection);
}

/** The Issue's `data.target` when it is a string, else `''` (sort key). */
function issueTarget(issue: Issue): string {
  const target = issue.data?.['target'];
  return typeof target === 'string' ? target : '';
}

/** Lexicographic string compare yielding a stable `-1` / `0` / `1`. */
function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** Stable order for injected Issues: node, then target, then message. */
function compareIssuesForInjection(a: Issue, b: Issue): number {
  return (
    compareStrings(a.nodeIds[0] ?? '', b.nodeIds[0] ?? '') ||
    compareStrings(issueTarget(a), issueTarget(b)) ||
    compareStrings(a.message, b.message)
  );
}

/** Project a stored Issue to the injected shape (fixed key order). */
function projectIssue(issue: Issue): IFixerIssueProjection {
  const data = issue.data ?? {};
  const target = data['target'];
  const kind = data['kind'];
  return {
    target: typeof target === 'string' ? target : null,
    kind: typeof kind === 'string' ? kind : null,
    severity: issue.severity,
    message: issue.message,
  };
}

/**
 * Render the `## Issues to resolve` section from ALREADY-SELECTED Issues
 * (`selectFixerIssues`): the heading, a one-line data-not-instructions
 * caution, then a fenced ```json array of the projected Issues. Callers MUST
 * NOT invoke this with an empty array, submit refuses a fixer with no
 * matching Issues BEFORE rendering (the same content-agnostic exit-2 gate
 * the findings case uses, `spec/job-lifecycle.md` §Findings injection for
 * fixers).
 */
export function buildIssuesSection(issues: readonly Issue[]): string {
  const projected = issues.map(projectIssue);
  const json = JSON.stringify(projected, null, 2);
  return (
    `${JOB_TEXTS.issuesToResolveHeading}\n\n` +
    `${JOB_TEXTS.issuesToResolveCaution}\n\n` +
    `\`\`\`json\n${json}\n\`\`\``
  );
}
