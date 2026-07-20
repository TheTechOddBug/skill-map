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
import type {
  IFindingResolutionEntry,
  IFindingRowInput,
  TResolutionActor,
} from '../types/storage.js';
import { FINDINGS_TEXTS } from '../i18n/findings.texts.js';
import { matchesQualifiedExtensionFilter } from '../util/analyzer-filter.js';

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
 * One active suppression entry (`annotations.suppressions`,
 * `spec/schemas/annotations.schema.json`) as the read-time lens matches
 * it: the qualified (or bare) finder `extension` it silences, and an
 * optional `type` slug that narrows it (absent = every type from that
 * extension).
 */
export interface ISuppressionMatch {
  extension: string;
  type?: string;
}

/**
 * A suppression entry with its operator-facing `note` kept: the display
 * shape `sm findings suppressions` lists and `sm findings undismiss`
 * echoes (`note` never affects matching).
 */
export interface ISuppressionEntry extends ISuppressionMatch {
  note?: string;
}

/**
 * Project a node's `annotations` object (the `.sm` sidecar's block, or its
 * denormalized `scan_nodes.annotations_json` mirror) to its active
 * suppression entries. Non-array or absent `suppressions` yields `[]`;
 * entries without a string `extension` are skipped (defensive, AJV pins
 * the shape on the write side).
 */
export function suppressionsFromAnnotations(annotations: unknown): ISuppressionEntry[] {
  if (typeof annotations !== 'object' || annotations === null) return [];
  const raw = (annotations as Record<string, unknown>)['suppressions'];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(toSuppressionEntry)
    .filter((entry): entry is ISuppressionEntry => entry !== null);
}

/** Narrow one raw `suppressions[]` entry, `null` without a string `extension`. */
function toSuppressionEntry(entry: unknown): ISuppressionEntry | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const extension = record['extension'];
  if (typeof extension !== 'string' || extension.length === 0) return null;
  const projected: ISuppressionEntry = { extension };
  if (typeof record['type'] === 'string') projected.type = record['type'];
  if (typeof record['note'] === 'string' && record['note'].length > 0) {
    projected.note = record['note'];
  }
  return projected;
}

/**
 * True when an active suppression silences a finding of `type` emitted by
 * `extensionId` (`spec/db-schema.md` §state_findings, the read-time
 * suppression lens): the suppression's `extension` matches the finder
 * (qualified or bare, `matchesQualifiedExtensionFilter`, mirroring
 * `sm check --analyzers`) and, when it narrows by `type`, the finding's
 * type equals it. Rows are never deleted or dropped over a suppression;
 * matching rows are HIDDEN at read time (the `dismissed` bucket) until
 * the entry leaves the `.sm` file.
 */
export function isFindingSuppressed(
  extensionId: string,
  type: string,
  suppressions: readonly ISuppressionMatch[],
): boolean {
  return suppressions.some(
    (s) =>
      matchesQualifiedExtensionFilter(extensionId, [s.extension]) &&
      (s.type === undefined || s.type === type),
  );
}

/**
 * Finder-lane rows (`origin = 'extension'`), one per `findings[]` entry.
 * Only meaningful for a probabilistic ANALYZER's report; the record path
 * never calls this for an Action (an Action report carrying a `findings`
 * array is not routed).
 *
 * Suppressions play NO role here: every judged row lands
 * (`spec/db-schema.md` §state_findings, the read-time suppression lens).
 * The LLM already judged the class either way, so dropping rows at record
 * time saved nothing and made an un-dismiss unable to show anything until
 * the next run; the lens hides suppressed classes at READ time instead.
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
 * finding into (`fixed` / `human-decision`), the deciding actor `by`
 * (`fixer` / `human`, only on a `fixed` entry), and its one-line `note`.
 *
 * Only meaningful for a FIXER's report (a probabilistic Action declaring
 * `precondition.analyzerIds`); the record path never calls this for a
 * finder. The fixer's `report.schema.json` REQUIRES the core fields, pins
 * `state` to the enum, and (via an `if/then`) REQUIRES `by` when `state` is
 * `fixed`, so the narrowing here is defensive: an entry whose `id` is not
 * an integer, whose `state` is neither `fixed` nor `human-decision` (an
 * off-contract payload that somehow cleared AJV, or the old `declined` /
 * `applied` shapes), or whose `fixed` entry carries no valid `by`, is
 * DROPPED rather than stamped against a coerced row.
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
 * `null` when it is off-contract (non-integer `id`; a `state` that is
 * neither `fixed` nor `human-decision`, e.g. the retired `declined` /
 * `applied` shapes; or a `fixed` entry whose `by` is not `human` / `fixer`).
 * The AJV validation upstream already pins these, so a non-null here is
 * redundant defense, not the validation gate. A `human-decision` entry
 * carries `by: null` (the actor is undecided; any `by` the report sent is
 * ignored).
 */
function narrowResolutionEntry(entry: unknown): IFindingResolutionEntry | null {
  if (!isRecord(entry)) return null;
  const id = validInteger(entry['id']);
  if (id === null) return null;
  const note = typeof entry['note'] === 'string' ? entry['note'] : '';
  const state = entry['state'];
  if (state === 'human-decision') return { id, state, by: null, note };
  if (state !== 'fixed') return null;
  // `state === 'fixed'`: `by` records the deciding actor and is REQUIRED.
  const by = validActor(entry['by']);
  if (by === null) return null;
  return { id, state, by, note };
}

/** The `id` when it is an integer, else `null` (off-contract, dropped). */
function validInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** The `by` actor when it is `human` / `fixer`, else `null` (off-contract). */
function validActor(value: unknown): TResolutionActor | null {
  return value === 'human' || value === 'fixer' ? value : null;
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
