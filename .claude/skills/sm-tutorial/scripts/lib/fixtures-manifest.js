/**
 * Reads `fixtures-data/manifest.json`, the index for the fixture
 * engine (sets, footprints, edits, seeds). Shared by `fixtures.js`
 * (lay / edit / seed / clear) and `state.js` (wipe reads footprints,
 * so the per-fixture on-disk reach lives in ONE place).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './io.js';
import { resolveTargetPath } from './paths.js';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
// lib/ -> scripts/ -> sm-tutorial/ -> fixtures-data/
const FIXTURES_DIR = resolve(LIB_DIR, '..', '..', 'fixtures-data');
const MANIFEST = resolve(FIXTURES_DIR, 'manifest.json');

export function fixturesDir() {
  return FIXTURES_DIR;
}

export function loadFixturesManifest() {
  return readJson(MANIFEST);
}

/** Footprint paths for a named fixture, resolved for the provider. */
export function resolveFootprint(manifest, name, provider) {
  const fp = manifest.footprints?.[name] ?? [];
  return fp.map((p) => resolveTargetPath(p, provider));
}
