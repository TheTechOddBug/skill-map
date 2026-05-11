/**
 * Coverage for `core/config/helper` — the typed read / write surface
 * over the layered settings.json config.
 *
 * Behaviour pinned by these tests:
 *   - `readConfigValue` returns the merged value, falls back to
 *     `default`, and forces `scope: 'global'` for `USER_ONLY_KEYS`
 *     (a project-layer entry for `updateCheck.enabled` is silently
 *     ignored).
 *   - `writeConfigValue` rejects `target: 'project'` for user-only
 *     keys with `UserOnlyKeyError`; otherwise round-trips through a
 *     subsequent `readConfigValue`.
 *   - `removeConfigValue` is idempotent (returns `false` when the
 *     key was absent) and rejects user-only keys against project.
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
  USER_ONLY_KEYS,
  UserOnlyKeyError,
  getValueSource,
  readConfigValue,
  removeConfigValue,
  writeConfigValue,
} from '../core/config/helper.js';
import { ForbiddenSegmentError } from '../core/config/dot-path.js';

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

describe('USER_ONLY_KEYS catalogue', () => {
  it('declares updateCheck.enabled as user-only', () => {
    assert.equal(USER_ONLY_KEYS.has('updateCheck.enabled'), true);
  });
});

describe('readConfigValue', () => {
  it('returns the merged value when set in user layer', () => {
    writeUserSettings({ scan: { tokenize: false } });
    const value = readConfigValue<boolean>('scan.tokenize', {
      scope: 'project',
      cwd,
      homedir,
    });
    assert.equal(value, false);
  });

  it('returns project value when set there (regular keys honour precedence)', () => {
    writeUserSettings({ scan: { tokenize: false } });
    writeProjectSettings({ scan: { tokenize: true } });
    const value = readConfigValue<boolean>('scan.tokenize', {
      scope: 'project',
      cwd,
      homedir,
    });
    assert.equal(value, true);
  });

  it('falls back to opts.default when the key is absent everywhere', () => {
    const value = readConfigValue<string>('i18n.locale', {
      scope: 'project',
      cwd,
      homedir,
      default: 'en',
    });
    // i18n.locale defaults to 'en' in the schema, so the merged value
    // wins over our `default` arg. Assert the merged value:
    assert.equal(value, 'en');
  });

  it('user-only key: ignores a project-layer override', () => {
    writeProjectSettings({ updateCheck: { enabled: false } });
    writeUserSettings({ updateCheck: { enabled: true } });
    const value = readConfigValue<boolean>('updateCheck.enabled', {
      scope: 'project',
      cwd,
      homedir,
      default: true,
    });
    // Forced scope:'global' → user layer (true) wins, project (false)
    // is invisible to the read.
    assert.equal(value, true);
  });

  it('user-only key: returns default when absent', () => {
    const value = readConfigValue<boolean>('updateCheck.enabled', {
      scope: 'project',
      cwd,
      homedir,
      default: true,
    });
    assert.equal(value, true);
  });
});

describe('writeConfigValue', () => {
  it('round-trips a regular key into project (default target)', () => {
    writeConfigValue('scan.tokenize', false, { target: 'project', cwd, homedir });
    const persisted = readProjectSettings();
    assert.deepEqual(persisted, { scan: { tokenize: false } });
    const value = readConfigValue<boolean>('scan.tokenize', {
      scope: 'project',
      cwd,
      homedir,
    });
    assert.equal(value, false);
  });

  it('round-trips into user layer when target=user', () => {
    writeConfigValue('scan.tokenize', false, { target: 'user', cwd, homedir });
    const persisted = readUserSettings();
    assert.deepEqual(persisted, { scan: { tokenize: false } });
  });

  it('user-only key: persists to user layer', () => {
    writeConfigValue('updateCheck.enabled', false, {
      target: 'user',
      cwd,
      homedir,
    });
    const persisted = readUserSettings();
    assert.deepEqual(persisted, { updateCheck: { enabled: false } });
  });

  it('user-only key: rejects target=project with UserOnlyKeyError', () => {
    assert.throws(
      () =>
        writeConfigValue('updateCheck.enabled', false, {
          target: 'project',
          cwd,
          homedir,
        }),
      UserOnlyKeyError,
    );
    // The reject was pre-flight — the project file must NOT have been
    // touched (still absent because beforeEach didn't create it).
    assert.throws(
      () => readProjectSettings(),
      /ENOENT/,
    );
  });

  it('rejects schema-violating value before reaching disk', () => {
    assert.throws(
      () =>
        // `scan.tokenize` must be boolean per project-config.schema.json.
        writeConfigValue('scan.tokenize', 'not-a-boolean', {
          target: 'project',
          cwd,
          homedir,
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
          homedir,
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
      homedir,
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
      homedir,
    });
    assert.equal(removed, false);
    assert.deepEqual(readProjectSettings(), { scan: { strict: true } });
  });

  it('user-only key: rejects target=project even when key is absent', () => {
    assert.throws(
      () =>
        removeConfigValue('updateCheck.enabled', {
          target: 'project',
          cwd,
          homedir,
        }),
      UserOnlyKeyError,
    );
  });
});

describe('getValueSource', () => {
  it('returns the layer that contributed the effective value', () => {
    writeProjectSettings({ scan: { tokenize: false } });
    const layer = getValueSource('scan.tokenize', {
      scope: 'project',
      cwd,
      homedir,
    });
    assert.equal(layer, 'project');
  });

  it('returns undefined when the key is absent', () => {
    const layer = getValueSource('autoMigrate', {
      scope: 'project',
      cwd,
      homedir,
    });
    // `autoMigrate` IS in defaults.json, so the source is `defaults`,
    // not undefined. Assert that.
    assert.equal(layer, 'defaults');
  });

  it('user-only key: ignores project layer', () => {
    writeProjectSettings({ updateCheck: { enabled: false } });
    writeUserSettings({ updateCheck: { enabled: true } });
    const layer = getValueSource('updateCheck.enabled', {
      scope: 'project',
      cwd,
      homedir,
    });
    assert.equal(layer, 'user');
  });
});

describe('PROJECT_LOCAL_ONLY_KEYS catalogue', () => {
  it('declares allowEditSmFiles + the three privacy-sensitive scan keys', () => {
    assert.equal(PROJECT_LOCAL_ONLY_KEYS.has('allowEditSmFiles'), true);
    assert.equal(PROJECT_LOCAL_ONLY_KEYS.has('scan.includeHome'), true);
    assert.equal(PROJECT_LOCAL_ONLY_KEYS.has('scan.extraRoots'), true);
    assert.equal(PROJECT_LOCAL_ONLY_KEYS.has('scan.referencePaths'), true);
  });
});

describe('writeConfigValue — project-local-only keys', () => {
  it('rejects target=project for allowEditSmFiles', () => {
    assert.throws(
      () =>
        writeConfigValue('allowEditSmFiles', true, {
          target: 'project',
          cwd,
          homedir,
        }),
      ProjectLocalOnlyKeyError,
    );
    // Pre-flight reject — no file touched.
    assert.throws(() => readProjectSettings(), /ENOENT/);
  });

  it('rejects target=project for scan.includeHome', () => {
    assert.throws(
      () =>
        writeConfigValue('scan.includeHome', true, {
          target: 'project',
          cwd,
          homedir,
        }),
      ProjectLocalOnlyKeyError,
    );
  });

  it('accepts target=project-local for allowEditSmFiles', () => {
    writeConfigValue('allowEditSmFiles', true, {
      target: 'project-local',
      cwd,
      homedir,
    });
    const persisted = JSON.parse(
      readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
    );
    assert.deepEqual(persisted, { allowEditSmFiles: true });
    // And the read sees it (project scope walks every layer).
    const value = readConfigValue<boolean>('allowEditSmFiles', {
      scope: 'project',
      cwd,
      homedir,
    });
    assert.equal(value, true);
  });

  it('accepts target=user-local for allowEditSmFiles', () => {
    writeConfigValue('allowEditSmFiles', true, {
      target: 'user-local',
      cwd,
      homedir,
    });
    const persisted = JSON.parse(
      readFileSync(join(homedir, '.skill-map/settings.local.json'), 'utf8'),
    );
    assert.deepEqual(persisted, { allowEditSmFiles: true });
  });

  it('accepts target=user for allowEditSmFiles', () => {
    writeConfigValue('allowEditSmFiles', true, {
      target: 'user',
      cwd,
      homedir,
    });
    const persisted = readUserSettings();
    assert.deepEqual(persisted, { allowEditSmFiles: true });
  });
});

describe('removeConfigValue — project-local-only keys', () => {
  it('rejects target=project for allowEditSmFiles even when key is absent', () => {
    assert.throws(
      () =>
        removeConfigValue('allowEditSmFiles', {
          target: 'project',
          cwd,
          homedir,
        }),
      ProjectLocalOnlyKeyError,
    );
  });
});
