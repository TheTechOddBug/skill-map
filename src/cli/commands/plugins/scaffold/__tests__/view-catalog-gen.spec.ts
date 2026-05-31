/**
 * Unit tests for the view-catalog drift guard (`scripts/generate-view-catalog.js`).
 * The pure comparator functions are exercised directly; a final spawn check
 * asserts the committed mirrors are in sync with the spec so a stale
 * `view-catalog.generated.ts` / `slots-catalog.ts` / UI union fails here too,
 * not only in `validate:compile`.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  diffSets,
  parseUiSlotUnion,
  renderKernel,
} from '../../../../../../scripts/generate-view-catalog.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '../../../../../../scripts/generate-view-catalog.js');

describe('view-catalog codegen comparator', () => {
  it('diffSets reports added and removed names', () => {
    const d = diffSets(new Set(['a', 'b']), new Set(['b', 'c']));
    assert.deepEqual(d.added, ['c']);
    assert.deepEqual(d.removed, ['a']);
  });

  it('diffSets is empty when the sets match', () => {
    const d = diffSets(new Set(['a', 'b']), new Set(['b', 'a']));
    assert.deepEqual(d.added, []);
    assert.deepEqual(d.removed, []);
  });

  it('parseUiSlotUnion extracts the TSlotId members and stops at the union', () => {
    const src = [
      'export type TSlotId =',
      "  | 'card.footer.left'",
      "  | 'topbar.nav.start';",
      "export const SLOT_REGISTRY = { 'card.subtitle.left': {} };",
    ].join('\n');
    assert.deepEqual(
      [...parseUiSlotUnion(src)].sort(),
      ['card.footer.left', 'topbar.nav.start'],
    );
  });

  it('renderKernel is deterministic and emits the union + runtime arrays', () => {
    const slots = [{ id: 'card.footer.left', summary: 'x' }];
    const inputs = [{ id: 'string-list', summary: 'y' }];
    const a = renderKernel(slots, inputs);
    assert.equal(a, renderKernel(slots, inputs));
    assert.match(a, /export type TSlotName =/);
    assert.match(a, /export const ALL_SLOT_NAMES/);
    assert.match(a, /export const KNOWN_SLOT_NAMES/);
    assert.match(a, /export const ALL_INPUT_TYPE_NAMES/);
  });

  it('the committed mirrors are in sync with the spec (--check passes)', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `drift detected:\n${r.stdout}\n${r.stderr}`);
  });

  it('--check fails (exit 1) when a committed mirror drifts from the spec', () => {
    const catalogPath = resolve(HERE, '../../slots-catalog.ts');
    const original = readFileSync(catalogPath, 'utf8');
    try {
      // Drop one slot entry so the committed CLI mirror no longer matches
      // what the codegen derives from the spec. Safe to mutate the source:
      // spawned `sm` binaries read dist (not this file) and no spec imports
      // it in-process; `finally` restores it even if the assertion throws.
      const mutated = original
        .split('\n')
        .filter((line) => !line.includes("'topbar.nav.start'"))
        .join('\n');
      assert.notEqual(mutated, original, 'sanity: the mutation dropped a line');
      writeFileSync(catalogPath, mutated);
      const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
      assert.equal(r.status, 1, `drifted mirror must fail --check:\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /stale/);
    } finally {
      writeFileSync(catalogPath, original);
    }
  });
});
