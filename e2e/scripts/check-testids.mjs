/**
 * Testid tripwire: every STATIC `getByTestId('...')` literal (and
 * static `data-testid="..."` selector) the e2e specs pin must exist
 * somewhere in `ui/src`, or the spec is asserting against retired UI.
 *
 * Why it exists: the live-bff project is the expensive half of the
 * suite, and before it joined `validate:test` its pins rotted silently,
 * `map-scope.spec.ts` asserted `graph-show-all-toolbar` for two and a
 * half months after the workspace fusion retired that testid
 * (2026-06-02, found 2026-08-17). Running the suite catches that class
 * too, but this check catches it in milliseconds, with the exact
 * testid named, before any browser boots.
 *
 * Dynamic pins (a spec pinning one INSTANCE of a UI-side computed
 * testid) cannot exact-match the source, so each one carries an
 * explicit `needle` that must still exist in `ui/src`: the allowlist
 * verifies, it never exempts. Template-literal testids in specs
 * (`` getByTestId(`graph-node-${path}`) ``) are out of scope, the
 * static prefix they interpolate is exercised at runtime by the suite.
 *
 * Anti-vacuity: the run fails if suspiciously few literals are found
 * (extractor drift must fail loud, not scan nothing and pass).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const UI_SRC = resolve(E2E_ROOT, '..', 'ui', 'src');

/** Fewer extracted literals than this = the extractor itself broke. */
const MIN_EXPECTED_LITERALS = 20;

/**
 * Spec literals that are one INSTANCE of a UI-side computed testid.
 * `needle` is the construction-site fragment that must exist in
 * `ui/src`; if the UI rename retires it, this check fails like any
 * other miss.
 */
const DYNAMIC_PINS = new Map([
  ['files-vis-folder-docs', "'files-vis-folder-' + row.path"],
]);

function* walk(dir, skip) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path, skip);
    else yield path;
  }
}

function collectSpecLiterals() {
  const literals = new Set();
  const skip = new Set(['node_modules', 'test-results', 'playwright-report', 'scripts']);
  for (const path of walk(E2E_ROOT, skip)) {
    if (!path.endsWith('.ts')) continue;
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/getByTestId\((['"])([^'"`]+)\1\)/g)) {
      literals.add(match[2]);
    }
    for (const match of text.matchAll(/data-testid="([^"$]+)"/g)) {
      literals.add(match[1]);
    }
  }
  return literals;
}

function collectUiSource() {
  const chunks = [];
  for (const path of walk(UI_SRC, new Set(['node_modules']))) {
    if (path.endsWith('.ts') || path.endsWith('.html')) chunks.push(readFileSync(path, 'utf8'));
  }
  return chunks.join('\n');
}

const literals = collectSpecLiterals();
if (literals.size < MIN_EXPECTED_LITERALS) {
  console.error(
    `check-testids: extractor found only ${literals.size} literals (expected >= ${MIN_EXPECTED_LITERALS}); the extractor drifted, fix it instead of trusting a near-empty scan`,
  );
  process.exit(1);
}

const uiSource = collectUiSource();
const misses = [];
for (const literal of [...literals].sort()) {
  const needle = DYNAMIC_PINS.get(literal) ?? literal;
  if (!uiSource.includes(needle)) misses.push({ literal, needle });
}

if (misses.length > 0) {
  console.error('check-testids: e2e specs pin testids that no longer exist in ui/src:');
  for (const { literal, needle } of misses) {
    const via = needle === literal ? '' : ` (via needle "${needle}")`;
    console.error(`  - ${literal}${via}`);
  }
  process.exit(1);
}

console.log(`check-testids: ${literals.size} testid pins verified against ui/src`);
