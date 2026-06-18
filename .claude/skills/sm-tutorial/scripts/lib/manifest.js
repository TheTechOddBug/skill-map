/**
 * Reads the generated book ToC sidecar (`references/_manifest.json`)
 * that the repo codegen emits from `_manifest.yml`. Zero-dep: plain
 * `JSON.parse`. The `.yml` is never parsed at runtime (its bespoke
 * chapter shorthand is not standard YAML).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './io.js';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
// lib/ -> scripts/ -> sm-tutorial/ -> references/_manifest.json
const MANIFEST = resolve(LIB_DIR, '..', '..', 'references', '_manifest.json');

export function loadManifest() {
  return readJson(MANIFEST);
}

export function findPart(manifest, id) {
  return manifest.parts.find((p) => p.id === id) ?? null;
}
