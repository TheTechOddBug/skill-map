/**
 * Row builders for the `state_findings` write-through
 * (`spec/db-schema.md` §state_findings, `spec/job-lifecycle.md` §Record).
 * The record path composes an `IFindingsWriteIntent` out of a validated
 * `completed` probabilistic report through two lanes:
 *
 *   - **Finder lane** (`extensionFindingRows`, `origin = 'extension'`):
 *     one row per entry of a probabilistic Analyzer's `findings[]` array.
 *     Per-row `confidence` is the finding's own value when present, else
 *     the report-level `confidence`.
 *   - **Safety lane** (`kernelSafetyRows`, `origin = 'kernel'`): for
 *     EVERY probabilistic report (Action or Analyzer) whose `safety`
 *     block flags trouble, synthesized rows under the RESERVED type
 *     slugs, message from the kernel catalog
 *     (`kernel/i18n/findings.texts.ts`), `safety.injectionDetails`
 *     folded into `detail` when present.
 *
 * `findReservedFindingTypes` backs the record-time rejection: extensions
 * MUST NOT emit the reserved slugs themselves; a `findings[]` entry that
 * does fails the job as `report-invalid` (spec: implementations SHOULD
 * reject).
 *
 * Inputs are the ALREADY-VALIDATED report (AJV against the extension's
 * own `report.schema.json`, which extends the canonical envelopes), so
 * the narrowing here is defensive, not a validation layer.
 */

import type { Severity } from '../types.js';
import type { IFindingResolutionEntry, IFindingRowInput } from '../types/storage.js';
import { FINDINGS_TEXTS } from '../i18n/findings.texts.js';

/**
 * Type slugs reserved for kernel-derived safety findings
 * (`spec/schemas/findings/report.schema.json`, `type` description).
 * Extensions must never emit them in `findings[]`.
 */
export const RESERVED_FINDING_TYPES: ReadonlySet<string> = new Set([
  'injection-detected',
  'content-suspicious',
  'content-malformed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Report-level `confidence`; `0` only on a degenerate (off-contract) report. */
function reportConfidence(report: Record<string, unknown>): number {
  const value = report['confidence'];
  return typeof value === 'number' ? value : 0;
}

/** The report's `findings` array entries that are object-shaped. */
function findingEntries(report: Record<string, unknown>): Record<string, unknown>[] {
  const raw = report['findings'];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord);
}

/**
 * Reserved type slugs used by the report's `findings[]` entries, in
 * entry order, deduped. Non-empty means the record MUST fail the job as
 * `report-invalid` instead of writing anything.
 */
export function findReservedFindingTypes(report: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const entry of findingEntries(report)) {
    const type = entry['type'];
    if (typeof type === 'string' && RESERVED_FINDING_TYPES.has(type) && !out.includes(type)) {
      out.push(type);
    }
  }
  return out;
}

/**
 * Finder-lane rows (`origin = 'extension'`), one per `findings[]` entry.
 * Only meaningful for a probabilistic ANALYZER's report; the record path
 * never calls this for an Action (an Action report carrying a `findings`
 * array is not routed).
 */
export function extensionFindingRows(report: Record<string, unknown>): IFindingRowInput[] {
  const fallbackConfidence = reportConfidence(report);
  return findingEntries(report).map((entry) => ({
    origin: 'extension' as const,
    type: typeof entry['type'] === 'string' ? entry['type'] : '',
    severity: entrySeverity(entry['severity']),
    message: typeof entry['message'] === 'string' ? entry['message'] : '',
    detail: typeof entry['detail'] === 'string' ? entry['detail'] : null,
    confidence:
      typeof entry['confidence'] === 'number' ? entry['confidence'] : fallbackConfidence,
  }));
}

/** AJV already pinned the enum; degrade off-contract values to `info`. */
function entrySeverity(value: unknown): Severity {
  return value === 'error' || value === 'warn' || value === 'info' ? value : 'info';
}

/**
 * The FIXER lane's report narrowing (`spec/job-lifecycle.md` §Findings
 * injection for fixers, "The resolution"): one entry per `resolved[]`
 * element the fixer echoed back, carrying the finding `id` it copied
 * verbatim from the injected findings section, the `state` it moved the
 * finding into (`fixed` / `declined`), and its one-line `note`.
 *
 * Only meaningful for a FIXER's report (a probabilistic Action declaring
 * `precondition.analyzerIds`); the record path never calls this for a
 * finder. The fixer's `report.schema.json` REQUIRES all three fields and
 * pins `state` to the enum, so the narrowing here is defensive: an entry
 * whose `id` is not an integer, or whose `state` is neither `fixed` nor
 * `declined` (an off-contract payload that somehow cleared AJV, or the old
 * `applied` boolean shape), is DROPPED rather than stamped against a
 * coerced row.
 */
export function fixerResolutionEntries(
  report: Record<string, unknown>,
): IFindingResolutionEntry[] {
  const raw = report['resolved'];
  if (!Array.isArray(raw)) return [];
  const out: IFindingResolutionEntry[] = [];
  for (const entry of raw) {
    const narrowed = narrowResolutionEntry(entry);
    if (narrowed !== null) out.push(narrowed);
  }
  return out;
}

/**
 * Narrow one `resolved[]` element to an `IFindingResolutionEntry`, or
 * `null` when it is off-contract (non-integer `id`, or a `state` that is
 * neither `fixed` nor `declined`, e.g. the retired `applied` boolean
 * shape). The AJV validation upstream already pins both fields, so a
 * non-null here is redundant defense, not the validation gate.
 */
function narrowResolutionEntry(entry: unknown): IFindingResolutionEntry | null {
  if (!isRecord(entry)) return null;
  const id = entry['id'];
  if (typeof id !== 'number' || !Number.isInteger(id)) return null;
  const state = entry['state'];
  if (state !== 'fixed' && state !== 'declined') return null;
  return { id, state, note: typeof entry['note'] === 'string' ? entry['note'] : '' };
}

/**
 * Safety-lane rows (`origin = 'kernel'`) for any probabilistic report:
 * `injection-detected` (warn) when `safety.injectionDetected = true`,
 * `content-suspicious` (info) / `content-malformed` (warn) when
 * `safety.contentQuality` is not `clean`. Empty array on a clean block.
 */
export function kernelSafetyRows(report: Record<string, unknown>): IFindingRowInput[] {
  const safety = report['safety'];
  if (!isRecord(safety)) return [];
  const confidence = reportConfidence(report);
  const rows: IFindingRowInput[] = [];
  if (safety['injectionDetected'] === true) {
    rows.push({
      origin: 'kernel',
      type: 'injection-detected',
      severity: 'warn',
      message: FINDINGS_TEXTS.injectionDetected,
      detail: typeof safety['injectionDetails'] === 'string' ? safety['injectionDetails'] : null,
      confidence,
    });
  }
  if (safety['contentQuality'] === 'suspicious') {
    rows.push({
      origin: 'kernel',
      type: 'content-suspicious',
      severity: 'info',
      message: FINDINGS_TEXTS.contentSuspicious,
      detail: null,
      confidence,
    });
  }
  if (safety['contentQuality'] === 'malformed') {
    rows.push({
      origin: 'kernel',
      type: 'content-malformed',
      severity: 'warn',
      message: FINDINGS_TEXTS.contentMalformed,
      detail: null,
      confidence,
    });
  }
  return rows;
}
