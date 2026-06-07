/**
 * Coverage for `core/config/sidecar-consent`, the pre-flight gate
 * every `.sm` write funnels through.
 *
 * Branches under test (Step 17 split, Decision #5):
 *   - Flag already true                    -> no-op (no throw, no write).
 *   - Flag false + `always: true`          -> flips the flag in
 *     project-local (persists), returns silently.
 *   - Flag false + `confirm: true`         -> one-shot grant, returns
 *     silently WITHOUT persisting (next call re-asks).
 *   - Flag false + `always: true` even with `confirm` absent / false
 *     -> persists (`always` implies `confirm`, strong grant).
 *   - Flag false + neither                 -> throws `EConsentRequiredError`.
 *
 * Tests use file-based fixtures under `.tmp/` per AGENTS.md baseline;
 * no `:memory:`.
 */

import { strict as assert } from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  EConsentRequiredError,
  ensureSidecarWritesAllowed,
} from '../sidecar-consent.js';

let tempRoot: string;
let cwd: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'sm-consent-'));
  cwd = join(tempRoot, 'project');
  mkdirSync(join(cwd, '.skill-map'), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('ensureSidecarWritesAllowed', () => {
  it('no-ops when allowEditSmFiles is already true in project-local', () => {
    writeFileSync(
      join(cwd, '.skill-map/settings.local.json'),
      JSON.stringify({ allowEditSmFiles: true }),
      'utf8',
    );
    // Should not throw.
    ensureSidecarWritesAllowed({ confirm: false, cwd });
    // Did NOT write a fresh consent file (it was already there).
    const persisted = JSON.parse(
      readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
    );
    assert.deepEqual(persisted, { allowEditSmFiles: true });
  });

  it('persists the flag in project-local when always:true', () => {
    ensureSidecarWritesAllowed({ confirm: false, always: true, cwd });
    const persisted = JSON.parse(
      readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
    );
    assert.deepEqual(persisted, { allowEditSmFiles: true });
  });

  it('always:true persists even when confirm is absent (strong grant)', () => {
    ensureSidecarWritesAllowed({ confirm: false, always: true, cwd });
    const persisted = JSON.parse(
      readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
    );
    assert.deepEqual(persisted, { allowEditSmFiles: true });
  });

  it('confirm:true is one-shot, lets the write through but does NOT persist', () => {
    // Should not throw.
    ensureSidecarWritesAllowed({ confirm: true, cwd });
    // No file written, the one-shot grant is not remembered.
    assert.equal(
      existsSync(join(cwd, '.skill-map/settings.local.json')),
      false,
    );
    // The next call with the same one-shot signal still passes (still
    // does not persist), proving the grant did not become sticky.
    ensureSidecarWritesAllowed({ confirm: true, cwd });
    assert.equal(
      existsSync(join(cwd, '.skill-map/settings.local.json')),
      false,
    );
  });

  it('confirm:true alone re-asks on the next write without confirm', () => {
    // One-shot grant this time.
    ensureSidecarWritesAllowed({ confirm: true, cwd });
    // A subsequent write with NO consent throws, the one-shot grant did
    // not persist anything.
    let caught: unknown;
    try {
      ensureSidecarWritesAllowed({ confirm: false, cwd });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof EConsentRequiredError);
  });

  it('throws EConsentRequiredError when flag is false and neither confirm nor always', () => {
    let caught: unknown;
    try {
      ensureSidecarWritesAllowed({ confirm: false, cwd });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof EConsentRequiredError);
    assert.equal((caught as EConsentRequiredError).key, 'allowEditSmFiles');
    assert.equal((caught as EConsentRequiredError).hintTarget, 'project-local');
    // No write happened, settings.local.json was not created.
    assert.equal(
      existsSync(join(cwd, '.skill-map/settings.local.json')),
      false,
    );
  });

  it('decline does NOT persist a "no", next call still throws', () => {
    let caught1: unknown;
    try {
      ensureSidecarWritesAllowed({ confirm: false, cwd });
    } catch (err) {
      caught1 = err;
    }
    assert.ok(caught1 instanceof EConsentRequiredError);

    // Second pass, no file was written, so the gate throws again.
    let caught2: unknown;
    try {
      ensureSidecarWritesAllowed({ confirm: false, cwd });
    } catch (err) {
      caught2 = err;
    }
    assert.ok(caught2 instanceof EConsentRequiredError);
  });
});
