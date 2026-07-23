/**
 * Tagger detection from an Action's report schema
 * (`spec/job-lifecycle.md` §Tags write-through), the exact mirror of
 * the summarizer detection in `summary-schema.ts`: an Action opts into
 * the sidecar `annotations.tags` write-through through the output
 * contract it already owns, its `report.schema.json` extends a schema
 * under the canonical tags namespace (`spec/schemas/tags/`, today the
 * single `markdown.schema.json` shape) via `$ref`, typically inside
 * `allOf`. There is NO manifest flag; the record path infers the opt-in
 * from the schema the kernel already loads.
 *
 * The scan is purely structural: walk the report-schema JSON for any
 * `$ref` string carrying the canonical tags `$id` prefix. It never
 * compiles the schema.
 */

/** `$id` prefix shared by every `spec/schemas/tags/*.schema.json`. */
export const TAGS_SCHEMA_ID_PREFIX = 'https://skill-map.ai/spec/v0/tags/';

/**
 * True when the report schema references a `tags/*.schema.json`,
 * i.e. the Action is a TAGGER: after a completed record the kernel
 * merges its report's `tags[]` into the node's sidecar
 * `annotations.tags` through the gated `.sm` channel. Works on both
 * report-schema sources: a plugin's on-disk `report.schema.json` and a
 * built-in's codegen-inlined `reportSchema` object.
 */
export function isTagsReportSchema(reportSchema: Record<string, unknown>): boolean {
  return scanForTagsRef(reportSchema);
}

/** Depth-first scan for a `$ref` under the tags `$id` prefix. */
function scanForTagsRef(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(scanForTagsRef);
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const ref = record['$ref'];
  if (typeof ref === 'string' && ref.startsWith(TAGS_SCHEMA_ID_PREFIX)) {
    return true;
  }
  return Object.values(record).some(scanForTagsRef);
}
