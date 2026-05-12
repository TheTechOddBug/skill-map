/**
 * Regression test: every `.sm` shipped under `fixtures/` (and any other
 * tracked fixture directory) must parse cleanly against the current
 * sidecar schema.
 *
 * Why this exists: the demo bundle (`web/demo/`) is generated from
 * `fixtures/demo-scope/` via `sm scan`. When the sidecar root shape
 * changed (the `for:` → `identity:` rename in the 0.18.x sidecar
 * spec), the demo fixtures kept the old shape; AJV silently rejected
 * them, the `annotations` extractor saw `sidecar.annotations === null`,
 * no path-style links were emitted, and the graph in the public demo
 * rendered with zero edges. This test catches that class of drift at
 * `npm test` time so the next schema change can't silently break the
 * showcase.
 */

import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { readSidecarFor } from '../kernel/sidecar/parse.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

function listSidecars(root: string): string[] {
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith('.sm')) continue;
    out.push(resolve(e.parentPath, e.name));
  }
  return out.sort();
}

describe('fixture sidecars validate against the current schema', () => {
  const sidecarPaths = listSidecars(resolve(REPO_ROOT, 'fixtures'));

  ok(sidecarPaths.length > 0, 'expected at least one .sm under fixtures/');

  for (const sidecarPath of sidecarPaths) {
    const rel = sidecarPath.slice(REPO_ROOT.length + 1);
    const mdPath = sidecarPath.replace(/\.sm$/, '.md');

    it(rel, () => {
      const result = readSidecarFor(mdPath);
      strictEqual(result.present, true, `${rel}: .sm should be detected`);
      const messages = result.issues.map((i) => i.message).join(' | ');
      strictEqual(result.issues.length, 0, `${rel}: parse issues: ${messages}`);
      ok(result.parsed !== null, `${rel}: parsed payload should be non-null`);
    });
  }
});
