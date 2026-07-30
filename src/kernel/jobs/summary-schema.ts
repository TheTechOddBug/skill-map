/**
 * Summarizer detection from an Action's report schema
 * (`spec/job-lifecycle.md` §Record). An Action opts into the
 * `state_summaries` write-through through the output contract it already
 * owns: its `report.schema.json` extends a schema under the canonical
 * summaries namespace (`spec/schemas/summaries/`, today the single
 * universal `markdown.schema.json` node-summary shape) via `$ref`,
 * typically inside `allOf`. There is NO manifest flag; a summarizer-specific
 * field has no place on the universal `IAction` contract, so the record
 * path infers the opt-in from the schema the kernel already loads.
 *
 * The scan is purely structural: walk the report-schema JSON for any
 * `$ref` string carrying the canonical summaries `$id` prefix and extract
 * the `<kind>` from the referenced filename. It never compiles the schema;
 * AJV resolution (the summaries schemas are registered on the kernel AJV,
 * see `kernel/adapters/schema-validators.ts`) is a separate concern on the
 * validation path.
 */

/** `$id` prefix shared by every `spec/schemas/summaries/<kind>.schema.json`. */
export const SUMMARY_SCHEMA_ID_PREFIX = 'https://skill-map.ai/spec/v1/summaries/';

const SCHEMA_FILE_SUFFIX = '.schema.json';

/**
 * Return the summary-schema stem (`'markdown'`, the only canonical shape
 * today) when the report schema references a `summaries/*.schema.json`,
 * else `null`. Non-null means the Action is a summarizer: `sm record`
 * upserts its validated `completed` report
 * into `state_summaries`. Works on both report-schema sources: a plugin's
 * on-disk `report.schema.json` and a built-in's codegen-inlined
 * `reportSchema` object.
 *
 * Note: `state_summaries.kind` stays the NODE's kind (read live from
 * `scan_nodes` by the record transaction); the kind returned here is only
 * the detection signal.
 */
export function summaryKindOfReportSchema(reportSchema: Record<string, unknown>): string | null {
  return scanForSummaryRef(reportSchema);
}

/** Depth-first scan for a `$ref` under the summaries `$id` prefix. */
function scanForSummaryRef(value: unknown): string | null {
  if (Array.isArray(value)) {
    return firstSummaryRefIn(value);
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = summaryRefKind(record['$ref']);
  if (direct !== null) {
    return direct;
  }
  return firstSummaryRefIn(Object.values(record));
}

/** First summary kind found across a list of nested schema values. */
function firstSummaryRefIn(values: readonly unknown[]): string | null {
  for (const item of values) {
    const kind = scanForSummaryRef(item);
    if (kind !== null) {
      return kind;
    }
  }
  return null;
}

/** Kind of a single `$ref` value, `null` unless it targets a summaries schema. */
function summaryRefKind(ref: unknown): string | null {
  if (typeof ref !== 'string' || !ref.startsWith(SUMMARY_SCHEMA_ID_PREFIX)) {
    return null;
  }
  return kindFromSummaryRef(ref);
}

/**
 * Extract `<kind>` from `<prefix><kind>.schema.json[#fragment]`. Rejects
 * refs that dive deeper than the summaries folder or don't target a
 * `*.schema.json` file (they are not canonical summary schemas).
 */
function kindFromSummaryRef(ref: string): string | null {
  const rest = ref.slice(SUMMARY_SCHEMA_ID_PREFIX.length);
  const hash = rest.indexOf('#');
  const file = hash === -1 ? rest : rest.slice(0, hash);
  if (!file.endsWith(SCHEMA_FILE_SUFFIX)) {
    return null;
  }
  const kind = file.slice(0, -SCHEMA_FILE_SUFFIX.length);
  if (kind.length === 0 || kind.includes('/')) {
    return null;
  }
  return kind;
}
