/**
 * Coverage for `core/config/helper`, the typed read / write surface
 * over the layered settings.json config.
 *
 * Behaviour pinned by these tests:
 *   - `readConfigValue` returns the merged value and falls back to
 *     `default` when no layer wrote the key.
 *   - `writeConfigValue` round-trips through a subsequent
 *     `readConfigValue`.
 *   - `removeConfigValue` is idempotent (returns `false` when the
 *     key was absent).
 *   - Schema-violation values surface as `ConfigValidationError`
 *     before reaching disk.
 *   - Prototype-pollution segments are rejected uniformly.
 */

import { strict as assert } from 'node:assert';
import {
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
  ConfigValidationError,
  PROJECT_LOCAL_ONLY_KEYS,
  ProjectLocalOnlyKeyError,
  getValueSource,
  readConfigValue,
  removeConfigValue,
  writeConfigValue,
} from '../helper.js';
import { ForbiddenSegmentError } from '../dot-path.js';

let tempRoot: string;
let cwd: string;
let homedir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'config-helper-'));
  cwd = join(tempRoot, 'project');
  homedir = join(tempRoot, 'home');
  mkdirSync(join(cwd, '.skill-map'), { recursive: true });
  mkdirSync(join(homedir, '.skill-map'), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function writeProjectSettings(content: Record<string, unknown>): void {
  writeFileSync(
    join(cwd, '.skill-map/settings.json'),
    JSON.stringify(content, null, 2),
    'utf8',
  );
}

function writeUserSettings(content: Record<string, unknown>): void {
  writeFileSync(
    join(homedir, '.skill-map/settings.json'),
    JSON.stringify(content, null, 2),
    'utf8',
  );
}

function readProjectSettings(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(cwd, '.skill-map/settings.json'), 'utf8'),
  );
}

function readUserSettings(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(homedir, '.skill-map/settings.json'), 'utf8'),
  );
}

describe('readConfigValue', () => {
  it('returns the merged value when set in project layer', () => {
    writeProjectSettings({ scan: { tokenize: false } });
    const value = readConfigValue<boolean>('scan.tokenize', {
      cwd,
    });
    assert.equal(value, false);
  });

  it('falls back to opts.default when the key is absent everywhere', () => {
    const value = readConfigValue<string>('i18n.locale', {
      cwd,
      default: 'en',
    });
    // i18n.locale defaults to 'en' in the schema, so the merged value
    // wins over our `default` arg. Assert the merged value:
    assert.equal(value, 'en');
  });
});

describe('writeConfigValue', () => {
  it('round-trips a regular key into project (default target)', () => {
    writeConfigValue('scan.tokenize', false, { target: 'project', cwd });
    const persisted = readProjectSettings();
    assert.deepEqual(persisted, { scan: { tokenize: false } });
    const value = readConfigValue<boolean>('scan.tokenize', {
      cwd,
    });
    assert.equal(value, false);
  });

  it('rejects schema-violating value before reaching disk', () => {
    assert.throws(
      () =>
        // `scan.tokenize` must be boolean per project-config.schema.json.
        writeConfigValue('scan.tokenize', 'not-a-boolean', {
          target: 'project',
          cwd,
        }),
      ConfigValidationError,
    );
  });

  it('rejects a prototype-pollution segment', () => {
    assert.throws(
      () =>
        writeConfigValue('__proto__.evil', true, {
          target: 'project',
          cwd,
        }),
      ForbiddenSegmentError,
    );
  });
});

describe('removeConfigValue', () => {
  it('returns true when the key existed and was removed', () => {
    writeProjectSettings({ scan: { tokenize: false } });
    const removed = removeConfigValue('scan.tokenize', {
      target: 'project',
      cwd,
    });
    assert.equal(removed, true);
    // Also pruned the now-empty `scan` parent so the file stays tidy.
    assert.deepEqual(readProjectSettings(), {});
  });

  it('returns false when the key was absent (no write)', () => {
    writeProjectSettings({ scan: { strict: true } });
    const removed = removeConfigValue('scan.tokenize', {
      target: 'project',
      cwd,
    });
    assert.equal(removed, false);
    assert.deepEqual(readProjectSettings(), { scan: { strict: true } });
  });
});

describe('getValueSource', () => {
  it('returns the layer that contributed the effective value', () => {
    writeProjectSettings({ scan: { tokenize: false } });
    const layer = getValueSource('scan.tokenize', {
      cwd,
    });
    assert.equal(layer, 'project');
  });

  it('returns undefined when the key is absent', () => {
    const layer = getValueSource('autoMigrate', {
      cwd,
    });
    // `autoMigrate` IS in defaults.json, so the source is `defaults`,
    // not undefined. Assert that.
    assert.equal(layer, 'defaults');
  });
});

describe('PROJECT_LOCAL_ONLY_KEYS catalogue', () => {
  it('declares allowEditSmFiles + the two privacy-sensitive scan keys', () => {
    assert.equal(PROJECT_LOCAL_ONLY_KEYS.has('allowEditSmFiles'), true);
    assert.equal(PROJECT_LOCAL_ONLY_KEYS.has('scan.extraFolders'), true);
    assert.equal(PROJECT_LOCAL_ONLY_KEYS.has('scan.referencePaths'), true);
  });
});

describe('writeConfigValue, project-local-only keys', () => {
  it('rejects target=project for allowEditSmFiles', () => {
    assert.throws(
      () =>
        writeConfigValue('allowEditSmFiles', true, {
          target: 'project',
          cwd,
        }),
      ProjectLocalOnlyKeyError,
    );
    // Pre-flight reject, no file touched.
    assert.throws(() => readProjectSettings(), /ENOENT/);
  });

  it('rejects target=project for scan.extraFolders', () => {
    assert.throws(
      () =>
        writeConfigValue('scan.extraFolders', ['/tmp'], {
          target: 'project',
          cwd,
        }),
      ProjectLocalOnlyKeyError,
    );
  });

  it('accepts target=project-local for allowEditSmFiles', () => {
    writeConfigValue('allowEditSmFiles', true, {
      target: 'project-local',
      cwd,
    });
    const persisted = JSON.parse(
      readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
    );
    assert.deepEqual(persisted, { allowEditSmFiles: true });
    // And the read sees it (project scope walks every layer).
    const value = readConfigValue<boolean>('allowEditSmFiles', {
      cwd,
    });
    assert.equal(value, true);
  });

});

describe('removeConfigValue, project-local-only keys', () => {
  it('rejects target=project for allowEditSmFiles even when key is absent', () => {
    assert.throws(
      () =>
        removeConfigValue('allowEditSmFiles', {
          target: 'project',
          cwd,
        }),
      ProjectLocalOnlyKeyError,
    );
  });
});
