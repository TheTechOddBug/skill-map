/**
 * Static guard: every `target="_blank"` the SPA renders MUST carry
 * `rel="noopener noreferrer"`.
 *
 * Without `noopener` the opened page gets a live `opener` handle back
 * into this origin (reverse tabnabbing, `opener.location = ...`);
 * without `noreferrer` the destination learns which internal route the
 * operator came from. Audit `app-hacker` L3 / R1.
 *
 * Why a script and not a unit test: this is a static source scan, not an
 * assertion about runtime behaviour, and it lives with the repo's other
 * compile-phase checks (`built-ins:check`, `view-catalog:check`,
 * `pin:check`). It replaces a vitest spec that reached templates through
 * Vite's `import.meta.glob`, which could only ever see `.html` files:
 * extending that glob to `.ts` made Angular's CLI plugin double-process
 * component sources and surface stale template-typecheck errors against
 * the synthesised second copy. Inline templates were therefore uncovered,
 * and the rule survived on review vigilance. Reading bytes off disk has
 * no such limit, so `.ts` sources (inline templates, markup built in
 * code, string constants) are now covered by the same pass.
 *
 * Scanning whole `.ts` files rather than just `template:` blocks is
 * deliberate: any `target="_blank"` a component can emit is a link the
 * SPA renders, wherever the string was assembled.
 *
 * Exits 1 with a per-violation report; silent on success.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src');

/**
 * Floor for the sanity check. A wrong root or a broken walk would
 * otherwise scan nothing and pass, which looks identical to compliance.
 * `ui/src` holds ~427 `.ts` / `.html` files today, ~308 of them once
 * specs are excluded; 100 leaves room for large consolidations without
 * turning the floor into maintenance.
 */
const MIN_SOURCES_SCANNED = 100;

/** Directory names never worth scanning. */
const SKIP_DIRS = new Set(['__tests__', 'node_modules', 'out-tsc']);

function collectSources(dir, into = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSources(full, into);
      continue;
    }
    // Specs assert against templates and legitimately carry literal
    // `target="_blank"` matchers they never render.
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.html')) continue;
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.html')) into.push(full);
  }
  return into;
}

/**
 * Collect every `target="_blank"` whose enclosing tag lacks a `rel` with
 * both tokens. The tag boundary is the span from the preceding `<` to
 * the next `>`, so a `rel` on a sibling element never counts as cover.
 */
function scanSource(file, src, into) {
  const targetRe = /target\s*=\s*["']_blank["']/g;
  let m;
  while ((m = targetRe.exec(src)) !== null) {
    const tagStart = src.lastIndexOf('<', m.index);
    const tagEnd = src.indexOf('>', m.index);
    if (tagStart < 0 || tagEnd < 0) continue;
    const tag = src.slice(tagStart, tagEnd + 1);
    const rel = /\brel\s*=\s*["']([^"']*)["']/.exec(tag)?.[1] ?? '';
    if (rel.includes('noopener') && rel.includes('noreferrer')) continue;
    into.push({
      file,
      line: src.slice(0, m.index).split('\n').length,
      snippet: tag.replace(/\s+/g, ' ').trim().slice(0, 160),
    });
  }
}

const sources = collectSources(SRC_ROOT);

if (sources.length < MIN_SOURCES_SCANNED) {
  console.error(
    `[check-external-links] scanned only ${sources.length} sources under ${SRC_ROOT}, ` +
      `expected at least ${MIN_SOURCES_SCANNED}. The walk is broken, not the tree.`,
  );
  process.exit(1);
}

const violations = [];
for (const file of sources) {
  scanSource(relative(SRC_ROOT, file), readFileSync(file, 'utf8'), violations);
}

if (violations.length > 0) {
  console.error(
    `[check-external-links] ${violations.length} target="_blank" anchor(s) missing rel="noopener noreferrer":`,
  );
  for (const v of violations) console.error(`  ${v.file}:${v.line} -> ${v.snippet}`);
  console.error('\nAdd rel="noopener noreferrer" to each. See context/ui.md §External-link safety.');
  process.exit(1);
}

console.log(`[check-external-links] OK (${sources.length} sources scanned).`);
