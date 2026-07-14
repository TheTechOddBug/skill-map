/**
 * Canonical prompt preamble loader.
 *
 * The verbatim preamble text is a normative spec artifact
 * (`spec/prompt-preamble.md` §The preamble text) and is reproduced
 * byte-for-byte in the conformance fixture
 * `spec/conformance/fixtures/preamble-v2.txt`. Rather than hand-copy those
 * ~2.6 KB into a TS constant (which drifts silently), the kernel reads the
 * fixture straight from the installed `@skill-map/spec` package, the same
 * single-source strategy `schema-validators.ts` uses for JSON Schemas. The
 * conformance case `preamble-bitwise-match` asserts the rendered job
 * content contains this text verbatim.
 *
 * The read is cached after the first call (the fixture never changes at
 * runtime).
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

let cachedPreamble: string | null = null;

/**
 * Locate the installed `@skill-map/spec` package root via Node's
 * resolver. `./index.json` is always exported and lives at the package
 * root, so its directory is the root. Mirrors
 * `schema-validators.ts:resolveSpecRoot`.
 */
function resolveSpecRoot(): string {
  const require = createRequire(import.meta.url);
  const indexPath = require.resolve('@skill-map/spec/index.json');
  return dirname(indexPath);
}

/**
 * Return the canonical preamble text, verbatim from the spec conformance
 * fixture. Cached after first read.
 */
export function loadCanonicalPreamble(): string {
  if (cachedPreamble !== null) return cachedPreamble;
  const specRoot = resolveSpecRoot();
  const preamblePath = join(specRoot, 'conformance', 'fixtures', 'preamble-v2.txt');
  cachedPreamble = readFileSync(preamblePath, 'utf8');
  return cachedPreamble;
}
