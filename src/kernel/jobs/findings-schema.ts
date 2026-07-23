/**
 * Finder detection from a probabilistic Analyzer's report schema
 * (`spec/job-lifecycle.md` §Record, findings write-through). A
 * probabilistic Analyzer's `report.schema.json` MUST extend the canonical
 * findings envelope (`spec/schemas/findings/report.schema.json`) via
 * `$ref`, typically inside `allOf`; the loader enforces the reference at
 * manifest load time (`invalid-manifest` otherwise) and `sm record`
 * routes the validated `findings[]` array into `state_findings`.
 *
 * Exact mirror of `summary-schema.ts`: the scan is purely structural,
 * walk the report-schema JSON for any `$ref` string carrying the
 * canonical findings `$id` prefix and targeting a `*.schema.json` file
 * directly under the namespace. It never compiles the schema; AJV
 * resolution (the findings envelope is registered on the kernel AJV, see
 * `kernel/adapters/schema-validators.ts`) is a separate concern on the
 * validation path.
 */

/** `$id` prefix shared by every `spec/schemas/findings/*.schema.json`. */
export const FINDINGS_SCHEMA_ID_PREFIX = 'https://skill-map.ai/spec/v0/findings/';

const SCHEMA_FILE_SUFFIX = '.schema.json';

/**
 * `true` when the report schema references a `findings/*.schema.json`
 * by `$ref` anywhere in its tree. Non-false means the extension's
 * validated `completed` report carries the canonical findings envelope;
 * the loader gates probabilistic Analyzers on it and `sm record` writes
 * the `findings[]` rows through to `state_findings`.
 */
export function reportSchemaExtendsFindings(reportSchema: Record<string, unknown>): boolean {
  return scanForFindingsRef(reportSchema);
}

/** Depth-first scan for a `$ref` under the findings `$id` prefix. */
function scanForFindingsRef(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => scanForFindingsRef(item));
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (isFindingsRef(record['$ref'])) {
    return true;
  }
  return Object.values(record).some((item) => scanForFindingsRef(item));
}

/**
 * `true` when a single `$ref` value targets a canonical findings schema:
 * carries the namespace prefix, ends in `.schema.json` (fragment
 * ignored), and does not dive deeper than the findings folder.
 */
function isFindingsRef(ref: unknown): boolean {
  if (typeof ref !== 'string' || !ref.startsWith(FINDINGS_SCHEMA_ID_PREFIX)) {
    return false;
  }
  const rest = ref.slice(FINDINGS_SCHEMA_ID_PREFIX.length);
  const hash = rest.indexOf('#');
  const file = hash === -1 ? rest : rest.slice(0, hash);
  if (!file.endsWith(SCHEMA_FILE_SUFFIX)) {
    return false;
  }
  const stem = file.slice(0, -SCHEMA_FILE_SUFFIX.length);
  return stem.length > 0 && !stem.includes('/');
}
