/**
 * Schema validation for the conformance runner's two schema assertions,
 * `file-matches-schema` and `stdout-matches-schema`.
 *
 * Both were declared in `conformance-case.schema.json` long before they
 * worked: `file-matches-schema` shipped as a stub that returned "not yet
 * implemented (requires ajv; lands with Step 2)" and always failed, and
 * `stdout-matches-schema` did not exist at all. No case used either, so
 * nothing was ever red and the gap stayed invisible until the spec v1.0.0
 * coverage gate needed them.
 *
 * --- Why this reads the spec tree instead of reusing the kernel's AJV ---
 *
 * `kernel/adapters/schema-validators.ts` compiles a CLOSED list of named
 * schemas, which is right for the kernel: it validates the shapes it
 * itself produces. A conformance runner has the opposite job. It checks
 * an implementation against the spec AS PUBLISHED, so it must be able to
 * name any schema in that tree, including one the kernel has no opinion
 * about. Borrowing the kernel's list would quietly scope conformance to
 * "the schemas this implementation already knows", which is precisely
 * the circularity a conformance suite exists to avoid.
 */

import { Ajv2020, type AnySchema } from 'ajv/dist/2020.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { applyAjvFormats } from '../kernel/util/ajv-interop.js';

/** Compiled-AJV cache, keyed by spec root: one tree walk per process. */
const ajvByRoot = new Map<string, Ajv2020>();

/**
 * An AJV instance with EVERY schema under `<specRoot>/schemas/`
 * registered, so cross-file `$ref`s resolve by `$id` no matter which
 * schema a case names.
 *
 * Registering the whole tree rather than the transitive closure of one
 * schema is deliberate: the closure would have to be computed by
 * chasing `$ref`s, and a missed edge fails at compile time with an
 * unresolved-reference error that reads like a broken case rather than
 * a missing registration.
 */
function specAjv(specRoot: string): Ajv2020 {
  const cached = ajvByRoot.get(specRoot);
  if (cached !== undefined) return cached;

  const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
  // Same format vocabulary the kernel registers. Without it AJV
  // silently IGNORES `format: "uri"` and friends, so the runner would
  // quietly validate less than the schema asks for, and a conformance
  // check that under-validates is worse than none: it reports green.
  applyAjvFormats(ajv);
  for (const file of collectSchemaFiles(join(specRoot, 'schemas'))) {
    let parsed: AnySchema;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8')) as AnySchema;
    } catch {
      // A malformed schema is the spec package's problem, not this
      // case's; skip it so one bad file cannot sink every assertion.
      continue;
    }
    const id = (parsed as { $id?: unknown }).$id;
    if (typeof id !== 'string' || ajv.getSchema(id) !== undefined) continue;
    try {
      ajv.addSchema(parsed);
    } catch {
      // Duplicate or unregisterable; the compile below reports the real
      // failure against the schema the case actually named.
    }
  }
  ajvByRoot.set(specRoot, ajv);
  return ajv;
}

/** Every `*.schema.json` under `dir`, recursively. */
function collectSchemaFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) out.push(...collectSchemaFiles(full));
    else if (entry.endsWith('.schema.json')) out.push(full);
  }
  return out;
}

export type TSchemaCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validate `payload` against the schema at `schemaRel` (relative to the
 * spec root, with or without a leading `schemas/`).
 *
 * Every failure mode returns a reason rather than throwing: a case that
 * names a missing schema, a schema that will not compile, and a payload
 * that genuinely violates its contract are all assertion failures the
 * report should show side by side.
 */
export function checkAgainstSchema(
  payload: unknown,
  schemaRel: string,
  specRoot: string,
): TSchemaCheck {
  const rel = schemaRel.startsWith('schemas/') ? schemaRel : `schemas/${schemaRel}`;
  const file = resolve(specRoot, rel);
  if (!existsSync(file)) return { ok: false, reason: `schema not found: ${rel}` };

  let schema: AnySchema;
  try {
    schema = JSON.parse(readFileSync(file, 'utf8')) as AnySchema;
  } catch (err) {
    return { ok: false, reason: `schema is not parseable JSON: ${rel} (${describe(err)})` };
  }

  const ajv = specAjv(specRoot);
  let validate;
  try {
    const id = (schema as { $id?: unknown }).$id;
    // Prefer the already-registered compilation so a schema that the
    // tree walk added is not compiled twice under two identities.
    validate = (typeof id === 'string' ? ajv.getSchema(id) : undefined) ?? ajv.compile(schema);
  } catch (err) {
    return { ok: false, reason: `schema failed to compile: ${rel} (${describe(err)})` };
  }

  if (validate(payload)) return { ok: true };
  return { ok: false, reason: `does not validate against ${rel}: ${ajv.errorsText(validate.errors)}` };
}

/**
 * Parse JSON for a schema assertion, reporting rather than throwing.
 *
 * Its own union rather than reusing `TSchemaCheck`: the success arm
 * carries a payload, and folding it into a type whose success arm does
 * not would leave `ok: true` non-discriminating for the caller.
 */
export type TSchemaPayload =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

export function parseJsonForSchema(raw: string, label: string): TSchemaPayload {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (err) {
    return { ok: false, reason: `${label} is not parseable JSON (${describe(err)})` };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
