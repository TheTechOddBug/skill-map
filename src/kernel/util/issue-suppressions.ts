/**
 * Read-side helpers for `annotations.issueSuppressions`
 * (`spec/schemas/annotations.schema.json`): the operator's standing
 * dismissals of DETERMINISTIC analyzer issues, keyed by
 * (analyzer, value). Issue-flavored mirror of the finding-suppression
 * projection in `kernel/jobs/findings-report.ts`, with one semantic
 * difference pinned by `spec/db-schema.md` §scan_issues: these entries
 * apply at EMISSION time (the analyzer consults them and skips both the
 * issue and its confidence penalty), not as a read-time lens, because
 * issues carry no stable row identity and are regenerated wholesale
 * each scan.
 */

import { matchesQualifiedExtensionFilter } from './analyzer-filter.js';

/**
 * One active issue-suppression entry: the `analyzer` it silences
 * (qualified id preferred, bare short id also matches, same grammar as
 * `sm check --analyzers`) and the verbatim `value` the issue flagged
 * (`Issue.data.target`, exact and case-sensitive). `note` is the
 * operator's own record and never affects matching.
 */
export interface IIssueSuppressionEntry {
  analyzer: string;
  value: string;
  note?: string;
}

/**
 * Project a node's `annotations` object (the `.sm` sidecar's block, or
 * its denormalized `scan_nodes.annotations_json` mirror) to its active
 * issue-suppression entries. Non-array or absent `issueSuppressions`
 * yields `[]`; entries missing a string `analyzer` or `value` are
 * skipped (defensive, AJV pins the shape on the write side).
 */
export function issueSuppressionsFromAnnotations(annotations: unknown): IIssueSuppressionEntry[] {
  if (typeof annotations !== 'object' || annotations === null) return [];
  const raw = (annotations as Record<string, unknown>)['issueSuppressions'];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(toIssueSuppressionEntry)
    .filter((entry): entry is IIssueSuppressionEntry => entry !== null);
}

/** Narrow one raw `issueSuppressions[]` entry, `null` without the key pair. */
function toIssueSuppressionEntry(entry: unknown): IIssueSuppressionEntry | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const analyzer = nonEmptyString(record['analyzer']);
  const value = nonEmptyString(record['value']);
  if (analyzer === null || value === null) return null;
  const projected: IIssueSuppressionEntry = { analyzer, value };
  const note = nonEmptyString(record['note']);
  if (note !== null) projected.note = note;
  return projected;
}

/** `string` with content, else `null` (split out for the complexity cap). */
function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * True when an active entry silences the (analyzer, value) pair. The
 * caller passes its QUALIFIED analyzer id (`<plugin>/<id>`) so entries
 * stored in either spelling match (`matchesQualifiedExtensionFilter`:
 * qualified verbatim, or bare suffix); `value` compares strict and
 * case-sensitive against the verbatim flagged token.
 */
export function isIssueSuppressed(
  qualifiedAnalyzerId: string,
  value: string,
  entries: readonly IIssueSuppressionEntry[],
): boolean {
  return entries.some(
    (e) => matchesQualifiedExtensionFilter(qualifiedAnalyzerId, [e.analyzer]) && e.value === value,
  );
}
