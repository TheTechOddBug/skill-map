/**
 * Kernel-agnosticism tripwire (user invariant 2026-07-23, `context/
 * kernel.md` §Kernel agnosticism invariants): `src/kernel/` must never
 * name a plugin or extension identity. Plugins load dynamically; the
 * kernel validates and forwards without knowing who exists. The former
 * counter-example (the hardcoded lock-list `kernel/config/
 * locked-plugins.ts`) was replaced by the manifest `locked` flag.
 *
 * The scan walks every kernel source file and fails on a NON-COMMENT
 * string literal shaped like a qualified extension id under a known
 * plugin namespace. Comments are exempt (docs may cite examples), and
 * so are test files (fixtures name ids on purpose).
 */

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const KERNEL_ROOT = new URL('../kernel/', import.meta.url).pathname;

/** Built-in plugin namespaces an id literal could belong to. */
const PLUGIN_NS = '(core|claude|antigravity|codex|opencode|agent-skills|github)';
const ID_LITERAL = new RegExp(`['\`"]${PLUGIN_NS}/[a-z][a-z0-9-]*['\`"]`);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
}

/** Strip line + block comments so documentation examples never trip the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('kernel agnosticism', () => {
  it('src/kernel names no plugin/extension identity outside comments', () => {
    const files: string[] = [];
    walk(KERNEL_ROOT, files);
    assert.ok(files.length > 50, `kernel walk looks wrong (${files.length} files)`);
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const match = ID_LITERAL.exec(code);
      if (match) offenders.push(`${file}: ${match[0]}`);
    }
    assert.deepEqual(
      offenders,
      [],
      'kernel sources must not name plugin/extension ids; move the knowledge to the manifest or the host layer',
    );
  });
});
