/**
 * Coverage for `core/config/active-provider:resolveActiveProvider` and
 * the `DEFAULT_LENS_ID` / `MARKDOWN_BASE_ID` constants.
 *
 * Behaviour pinned by these tests:
 *   - A project with no `activeProvider` setting and no filesystem marker
 *     resolves to the open-standard default lens (`DEFAULT_LENS_ID`,
 *     `agent-skills`) with source `'default'`, never null.
 *   - A stale persisted `activeProvider: 'markdown'` (the universal base,
 *     no longer a selectable lens) is coerced to the default rather than
 *     honoured, so the UI is never stuck on a non-lens value.
 *   - The resolver is pure: it writes nothing to disk (the default is a
 *     runtime-only resolution, never persisted, so a vendor marker added
 *     later still auto-detects).
 *   - `DEFAULT_LENS_ID` equals the SHORT id of the `agent-skills` provider.
 *     This guards the short-vs-qualified trap: the lens is compared against
 *     `provider.id` everywhere, so the default must be `'agent-skills'`.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  resolveActiveProvider,
  DEFAULT_LENS_ID,
  MARKDOWN_BASE_ID,
} from '../active-provider.js';
import { agentSkillsProvider } from '../../../plugins/agent-skills/providers/agent-skills/index.js';
import { coreMarkdownProvider } from '../../../plugins/core/providers/core-markdown/index.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-resolve-lens-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeActiveProvider(cwd: string, value: string): void {
  mkdirSync(join(cwd, '.skill-map'), { recursive: true });
  writeFileSync(
    join(cwd, '.skill-map', 'settings.json'),
    JSON.stringify({ activeProvider: value }),
    'utf8',
  );
}

describe('resolveActiveProvider', () => {
  it('defaults to the open-standard lens when no setting and no marker', () => {
    const r = resolveActiveProvider(tmpRoot, []);
    assert.deepEqual(r, { resolved: DEFAULT_LENS_ID, source: 'default', detected: [] });
    assert.equal(r.resolved, 'agent-skills');
  });

  it('honours a persisted vendor lens', () => {
    writeActiveProvider(tmpRoot, 'claude');
    const r = resolveActiveProvider(tmpRoot, []);
    assert.equal(r.resolved, 'claude');
    assert.equal(r.source, 'config');
  });

  it('coerces a stale persisted `markdown` to the default lens', () => {
    // `markdown` is the non-gated base, no longer a selectable lens; an
    // older project that pinned it must not stay stuck on a value the UI
    // can neither show nor switch away from.
    writeActiveProvider(tmpRoot, MARKDOWN_BASE_ID);
    const r = resolveActiveProvider(tmpRoot, []);
    assert.equal(r.resolved, DEFAULT_LENS_ID);
    assert.equal(r.source, 'default');
  });

  it('writes nothing to disk (the default lens is runtime-only)', () => {
    resolveActiveProvider(tmpRoot, []);
    assert.equal(
      existsSync(join(tmpRoot, '.skill-map')),
      false,
      'resolver must not create .skill-map; the default lens is never persisted',
    );
  });
});

describe('DEFAULT_LENS_ID', () => {
  it('equals the agent-skills provider SHORT id (not a qualified id)', () => {
    assert.equal(DEFAULT_LENS_ID, agentSkillsProvider.id);
    assert.equal(DEFAULT_LENS_ID, 'agent-skills');
    assert.notEqual(DEFAULT_LENS_ID, 'agent-skills/agent-skills');
  });
});

describe('MARKDOWN_BASE_ID', () => {
  it('equals the core/markdown provider SHORT id', () => {
    assert.equal(MARKDOWN_BASE_ID, coreMarkdownProvider.id);
    assert.equal(MARKDOWN_BASE_ID, 'markdown');
  });
});
