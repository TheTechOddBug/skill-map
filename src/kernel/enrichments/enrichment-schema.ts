/**
 * Enricher detection from an Action's report schema (the mirror of the
 * summaries write-through convention, `spec/db-schema.md`
 * §state_enrichments). An Action opts into the `state_enrichments`
 * write-through through the output contract it already owns: its
 * `report.schema.json` extends a schema under the canonical enrichments
 * namespace (`spec/schemas/enrichments/`, today the single
 * `github.schema.json` provenance shape) via `$ref`, typically inside
 * `allOf`. There is NO manifest flag; an enricher-specific field has no
 * place on the universal `IAction` contract, so the `sm refresh`
 * dispatcher infers the opt-in from the schema the kernel already loads.
 *
 * The scan is purely structural: walk the report-schema JSON for any
 * `$ref` string carrying the canonical enrichments `$id` prefix and
 * extract the `<kind>` from the referenced filename. It never compiles
 * the schema; AJV resolution (the enrichments schemas are registered on
 * the kernel AJV, see `kernel/adapters/schema-validators.ts`) is a
 * separate concern on the validation path.
 *
 * Mirror of `kernel/jobs/summary-schema.ts` with the enrichments `$id`
 * prefix; the two detections stay separate modules on purpose, each
 * write-through convention owns its namespace constant and its docs.
 */

/** `$id` prefix shared by every `spec/schemas/enrichments/<kind>.schema.json`. */
export const ENRICHMENT_SCHEMA_ID_PREFIX = 'https://skill-map.ai/spec/v0/enrichments/';

const SCHEMA_FILE_SUFFIX = '.schema.json';

/**
 * Return the enrichment-schema stem (`'github'`, the only canonical
 * shape today) when the report schema references an
 * `enrichments/*.schema.json`, else `null`. Non-null means the Action
 * is an enricher: `sm refresh` upserts its validated report into
 * `state_enrichments` keyed `(node_id, <qualified action id>)`. Works
 * on both report-schema sources: a plugin's on-disk `report.schema.json`
 * and a built-in's codegen-inlined `reportSchema` object.
 */
export function enrichmentKindOfReportSchema(
  reportSchema: Record<string, unknown>,
): string | null {
  return scanForEnrichmentRef(reportSchema);
}

/** Depth-first scan for a `$ref` under the enrichments `$id` prefix. */
function scanForEnrichmentRef(value: unknown): string | null {
  if (Array.isArray(value)) {
    return firstEnrichmentRefIn(value);
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = enrichmentRefKind(record['$ref']);
  if (direct !== null) {
    return direct;
  }
  return firstEnrichmentRefIn(Object.values(record));
}

/** First enrichment kind found across a list of nested schema values. */
function firstEnrichmentRefIn(values: readonly unknown[]): string | null {
  for (const item of values) {
    const kind = scanForEnrichmentRef(item);
    if (kind !== null) {
      return kind;
    }
  }
  return null;
}

/** Kind of a single `$ref` value, `null` unless it targets an enrichments schema. */
function enrichmentRefKind(ref: unknown): string | null {
  if (typeof ref !== 'string' || !ref.startsWith(ENRICHMENT_SCHEMA_ID_PREFIX)) {
    return null;
  }
  return kindFromEnrichmentRef(ref);
}

/**
 * Extract `<kind>` from `<prefix><kind>.schema.json[#fragment]`. Rejects
 * refs that dive deeper than the enrichments folder or don't target a
 * `*.schema.json` file (they are not canonical enrichment schemas).
 */
function kindFromEnrichmentRef(ref: string): string | null {
  const rest = ref.slice(ENRICHMENT_SCHEMA_ID_PREFIX.length);
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
