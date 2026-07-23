/**
 * Strings emitted from `core/jobs/record-outcome.ts` (the shared record
 * core). Convention mirrors `submit-engine.texts.ts`: flat `{{name}}`
 * templates interpolated by `tx` (`kernel/util/tx.ts`).
 *
 * Only the detail strings the record CORE authors live here; the CLI verb's
 * framing (`sm record` success / error lines) stays in
 * `cli/i18n/record.texts.ts`.
 */

export const RECORD_OUTCOME_TEXTS = {
  /**
   * Detail surfaced as a `report-invalid` reason when a finder report's
   * `findings[]` uses a kernel-reserved type slug (spec
   * `findings/report.schema.json`: extensions MUST NOT emit them).
   */
  reservedFindingTypes:
    'findings[] uses the reserved type slug(s) {{slugs}} ' +
    '(injection-detected / content-suspicious / content-malformed are kernel-derived and MUST NOT be emitted by extensions)',
} as const;
