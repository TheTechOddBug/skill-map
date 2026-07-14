/**
 * Report-contract section of the rendered job content
 * (`spec/job-lifecycle.md` §Submit step 9). Makes every job
 * self-contained: the draining agent never needs disk access or guesswork
 * to learn the output shape (live testing showed real agents inventing
 * `severity` values and burning their first job as `report-invalid`).
 *
 * Under a kernel-authored heading, one fenced ```json block per schema in
 * the chain, VERBATIM byte-copies in this order:
 *
 *   1. the extension's own `report.schema.json` (raw file bytes for
 *      on-disk plugins; for built-ins the codegen-inlined `reportSchema`
 *      object serialized deterministically, stable key order as authored,
 *      the caller supplies the text either way),
 *   2. the canonical namespace envelope it references, when one applies
 *      (`summaries/<kind>.schema.json` or `findings/report.schema.json`),
 *   3. `report-base.schema.json`.
 *
 * No dereferencing, no `$ref` rewriting: `$id` / `$ref` URLs are
 * identifiers, never fetched. The canonical spec bytes come from the SAME
 * installed `@skill-map/spec` package `schema-validators.ts` registers on
 * AJV (mirroring `preamble.ts`), so the inlined contract cannot drift
 * from what the record path enforces.
 *
 * The contract is kernel-authored prelude: it renders OUTSIDE the
 * `<user-content>` block and hashes into `promptTemplateHash`
 * (`content-hash.ts`), so a schema edit re-keys the content exactly like
 * a template edit does.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { JOB_TEXTS } from '../i18n/jobs.texts.js';
import { reportSchemaExtendsFindings } from './findings-schema.js';
import { summaryKindOfReportSchema } from './summary-schema.js';

/**
 * Locate the installed `@skill-map/spec` package root via Node's
 * resolver (mirrors `preamble.ts` / `schema-validators.ts`).
 */
function resolveSpecRoot(): string {
  const require = createRequire(import.meta.url);
  const indexPath = require.resolve('@skill-map/spec/index.json');
  return dirname(indexPath);
}

/** Per-process cache of canonical spec schema bytes (static artifacts). */
const specSchemaCache = new Map<string, string>();

/**
 * Verbatim bytes of a canonical spec schema, read from the installed
 * spec package (`<specRoot>/<relPath>`). Cached after the first read.
 */
export function loadSpecSchemaText(relPath: string): string {
  const cached = specSchemaCache.get(relPath);
  if (cached !== undefined) return cached;
  const text = readFileSync(join(resolveSpecRoot(), relPath), 'utf8');
  specSchemaCache.set(relPath, text);
  return text;
}

export interface IReportContractInput {
  /**
   * Verbatim text of the extension's own report schema: the raw
   * `report.schema.json` file bytes (on-disk plugin) or the
   * deterministically serialized codegen-inlined `reportSchema` object
   * (built-in, `JSON.stringify(obj, null, 2)`, key order as authored).
   */
  schemaText: string;
  /** The parsed schema object (namespace-envelope detection only). */
  schema: Record<string, unknown>;
}

/**
 * Relative spec path of the canonical namespace envelope the extension
 * schema references, or `null` when neither namespace applies (a
 * report-base-only Action). Findings is checked first: it is the finder
 * Analyzer contract and a schema never legitimately extends both.
 */
function envelopePathFor(schema: Record<string, unknown>): string | null {
  if (reportSchemaExtendsFindings(schema)) {
    return 'schemas/findings/report.schema.json';
  }
  const summaryKind = summaryKindOfReportSchema(schema);
  if (summaryKind !== null) {
    return `schemas/summaries/${summaryKind}.schema.json`;
  }
  return null;
}

/**
 * Wrap one schema's verbatim text in a fenced ```json block. The bytes
 * inside the fence are untouched; only a terminating newline is
 * guaranteed so the closing fence sits on its own line.
 */
function fenceJson(text: string): string {
  const body = text.endsWith('\n') ? text : `${text}\n`;
  return `\`\`\`json\n${body}\`\`\``;
}

/**
 * Compose the full report-contract section: heading, intro, then the
 * fenced schema chain (extension schema, namespace envelope when one
 * applies, report-base). Deterministic given the extension schema text;
 * the canonical blocks are stable spec artifacts.
 */
export function buildReportContract(input: IReportContractInput): string {
  const blocks: string[] = [fenceJson(input.schemaText)];
  const envelopePath = envelopePathFor(input.schema);
  if (envelopePath !== null) {
    blocks.push(fenceJson(loadSpecSchemaText(envelopePath)));
  }
  blocks.push(fenceJson(loadSpecSchemaText('schemas/report-base.schema.json')));
  return `${JOB_TEXTS.reportContractHeading}\n\n${JOB_TEXTS.reportContractIntro}\n\n${blocks.join('\n\n')}`;
}
