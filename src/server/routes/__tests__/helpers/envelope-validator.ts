/**
 * Shared AJV validator for `spec/schemas/api/rest-envelope.schema.json`.
 *
 * Seven spec files had each grown their own copy of this, and each copy
 * hand-registered the supporting schemas the envelope happened to `$ref`
 * at the time (only `view-slots.schema.json`). That is a list that goes
 * stale the moment the envelope references one more sibling: adding the
 * `node` / `link` / `issue` refs broke all seven at once, in a way that
 * reads as "the endpoint is broken" rather than "the harness is."
 *
 * So this loads EVERY schema under the spec root instead of naming any.
 * A schema the envelope does not reference costs one `addSchema` call
 * and nothing else; a schema it starts referencing tomorrow is already
 * there.
 */

import { Ajv2020 } from 'ajv/dist/2020.js';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

/**
 * Register every `*.schema.json` under `dir`, recursively. Keyed by the
 * document's own `$id`, which is how the envelope's relative `$ref`s
 * resolve; a schema without an `$id`, or a duplicate one, is skipped
 * rather than throwing (the loader is test scaffolding, not a gate, and
 * `spec:check` already guards `$id` integrity).
 */
function addSchemaTree(ajv: Ajv2020, dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      addSchemaTree(ajv, full);
      continue;
    }
    if (!entry.name.endsWith('.schema.json')) continue;
    const doc = JSON.parse(readFileSync(full, 'utf8')) as { $id?: string };
    if (typeof doc.$id !== 'string' || ajv.getSchema(doc.$id)) continue;
    ajv.addSchema(doc as object);
  }
}

/**
 * Resolve and compile the REST envelope schema against the INSTALLED
 * `@skill-map/spec` package (the same resolution the runtime uses), with
 * every sibling schema pre-registered.
 */
export function compileEnvelopeValidator(): ReturnType<Ajv2020['compile']> {
  const require = createRequire(import.meta.url);
  const specRoot = dirname(require.resolve('@skill-map/spec/index.json'));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addSchemaTree(ajv, resolve(specRoot, 'schemas'));
  const envelopeId = 'https://skill-map.ai/spec/v1/api/rest-envelope.schema.json';
  const compiled = ajv.getSchema(envelopeId);
  if (!compiled) {
    throw new Error(`envelope schema not found under ${specRoot} (looked for ${envelopeId})`);
  }
  return compiled as ReturnType<Ajv2020['compile']>;
}
