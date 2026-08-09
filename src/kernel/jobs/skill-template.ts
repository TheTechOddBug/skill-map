/**
 * Canonical skill-action artifacts loader (`spec/skill-actions.md`).
 *
 * Skills carry no `prompt.md` and no `report.schema.json`, so every skill
 * job renders through TWO spec-pinned constants:
 *
 *   - the canonical wrapper template (§The canonical wrapper template),
 *     normative and verbatim, reproduced byte-for-byte in the conformance
 *     fixture `spec/conformance/fixtures/skill-action-template-v1.txt`.
 *     Loaded from the installed `@skill-map/spec` package exactly like the
 *     canonical preamble (`preamble.ts`), never from a per-skill file.
 *   - the canonical report schema (§Report contract and record),
 *     `schemas/skill-actions/report.schema.json`, the ONE schema every
 *     skill action reports against. The record path resolves it from the
 *     `skill:` id prefix as a CONSTANT, without consulting the catalog,
 *     so an uninstalled skill never orphans its running job.
 *
 * Both reads are cached after the first call (static spec artifacts).
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { loadSpecSchemaText } from './report-contract.js';

let cachedTemplate: string | null = null;
let cachedReportSchema: Record<string, unknown> | null = null;

/**
 * Locate the installed `@skill-map/spec` package root via Node's
 * resolver. `./index.json` is always exported and lives at the package
 * root, so its directory is the root. Mirrors `preamble.ts`.
 */
function resolveSpecRoot(): string {
  const require = createRequire(import.meta.url);
  const indexPath = require.resolve('@skill-map/spec/index.json');
  return dirname(indexPath);
}

/**
 * Return the canonical skill-action wrapper template, verbatim from the
 * spec conformance fixture. Cached after first read. It contains
 * `{{userContent}}` exactly once and interpolates no user text of its
 * own, so it satisfies the delimiter contract by construction
 * (`spec/skill-actions.md` §The canonical wrapper template).
 */
export function loadCanonicalSkillTemplate(): string {
  if (cachedTemplate !== null) return cachedTemplate;
  const specRoot = resolveSpecRoot();
  const templatePath = join(specRoot, 'conformance', 'fixtures', 'skill-action-template-v1.txt');
  cachedTemplate = readFileSync(templatePath, 'utf8');
  return cachedTemplate;
}

/**
 * Verbatim bytes of the canonical skill-action report schema
 * (`schemas/skill-actions/report.schema.json`), the text the report
 * contract inlines at submit (the schema `$ref`s only
 * `../report-base.schema.json`, so the inlined chain is this schema plus
 * report-base). Rides the shared `loadSpecSchemaText` cache.
 */
export function loadSkillActionReportSchemaText(): string {
  return loadSpecSchemaText('schemas/skill-actions/report.schema.json');
}

/**
 * The parsed canonical skill-action report schema, the CONSTANT the
 * record path validates every `skill:` job's report against
 * (`spec/skill-actions.md` §Report contract and record). Cached after
 * the first parse; the stable `$id` also lets AJV reuse its compiled
 * validator across records.
 */
export function loadSkillActionReportSchema(): Record<string, unknown> {
  if (cachedReportSchema !== null) return cachedReportSchema;
  cachedReportSchema = JSON.parse(loadSkillActionReportSchemaText()) as Record<string, unknown>;
  return cachedReportSchema;
}
