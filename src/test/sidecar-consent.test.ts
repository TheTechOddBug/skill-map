/**
 * Coverage for `core/config/sidecar-consent`, the pre-flight gate
 * every `.sm` write funnels through.
 *
 * Three branches under test:
 *   - Flag already true → no-op (no throw, no write).
 *   - Flag false + `confirm: true` → flips the flag in project-local,
 *     returns silently.
 *   - Flag false + `confirm: false` → throws `EConsentRequiredError`.
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
} from '../core/config/sidecar-consent.js';

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

  it('flips the flag in project-local when confirm:true', () => {
    ensureSidecarWritesAllowed({ confirm: true, cwd });
    const persisted = JSON.parse(
      readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
    );
    assert.deepEqual(persisted, { allowEditSmFiles: true });
  });

  it('throws EConsentRequiredError when flag is false and confirm:false', () => {
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
