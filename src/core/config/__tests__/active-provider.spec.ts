/**
 * Coverage for `core/config/active-provider:resolveActiveProvider` and
 * the `MARKDOWN_LENS_ID` constant.
 *
 * Behaviour pinned by these tests:
 *   - A project with no `activeProvider` setting and no filesystem
 *     marker resolves to the universal markdown lens (`MARKDOWN_LENS_ID`)
 *     with source `'default'`, never null.
 *   - The resolver is pure: it writes nothing to disk (the markdown
 *     default is a runtime-only resolution, never persisted, so a
 *     vendor marker added later still auto-detects).
 *   - `MARKDOWN_LENS_ID` equals the SHORT id of the `core/markdown`
 *     provider. This guards the short-vs-qualified trap: the lens is
 *     compared against `provider.id` everywhere, so the default must be
 *     `'markdown'`, not the qualified `'core/markdown'`.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { resolveActiveProvider, MARKDOWN_LENS_ID } from '../active-provider.js';
import { coreMarkdownProvider } from '../../../plugins/core/providers/core-markdown/index.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-resolve-lens-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('resolveActiveProvider', () => {
  it('defaults to the markdown lens when no setting and no marker', () => {
    const r = resolveActiveProvider(tmpRoot, []);
    assert.deepEqual(r, { resolved: MARKDOWN_LENS_ID, source: 'default', detected: [] });
    assert.equal(r.resolved, 'markdown');
  });

  it('writes nothing to disk (the markdown default is runtime-only)', () => {
    resolveActiveProvider(tmpRoot, []);
    assert.equal(
      existsSync(join(tmpRoot, '.skill-map')),
      false,
      'resolver must not create .skill-map; the default lens is never persisted',
    );
  });
});

describe('MARKDOWN_LENS_ID', () => {
  it('equals the core/markdown provider SHORT id (not the qualified id)', () => {
    assert.equal(MARKDOWN_LENS_ID, coreMarkdownProvider.id);
    assert.equal(MARKDOWN_LENS_ID, 'markdown');
    assert.notEqual(MARKDOWN_LENS_ID, 'core/markdown');
  });
});
