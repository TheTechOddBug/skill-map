/**
 * Unit tests for the user-settings store
 * (`cli/util/user-settings-store.ts`). The store is the ONLY legitimate
 * `os.homedir()` reader in the codebase; tests redirect HOME via
 * `process.env.HOME` to a per-test tempdir so writes are sandboxed.
 *
 * Coverage:
 *   - read defaults when the file is missing / malformed,
 *   - schema validation rejects off-shape on-disk payloads (silent
 *     default, never throws),
 *   - write deep-merges into the existing envelope,
 *   - write rejects an off-shape patch without corrupting the file.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import {
  isUpdateCheckEnabled,
  readUserSettings,
  userSettingsFilePath,
  writeUserSettings,
} from '../cli/util/user-settings-store.js';

let homeRoot: string;
let originalHome: string | undefined;
let originalUserprofile: string | undefined;

before(() => {
  homeRoot = mkdtempSync(join(tmpdir(), 'skill-map-user-settings-'));
  originalHome = process.env['HOME'];
  originalUserprofile = process.env['USERPROFILE'];
  process.env['HOME'] = homeRoot;
  process.env['USERPROFILE'] = homeRoot;
});

after(() => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  if (originalUserprofile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = originalUserprofile;
  rmSync(homeRoot, { recursive: true, force: true });
});

/** Remove `~/.skill-map/` between tests so each starts clean. */
beforeEach(() => {
  rmSync(join(homeRoot, '.skill-map'), { recursive: true, force: true });
});

afterEach(() => {
  rmSync(join(homeRoot, '.skill-map'), { recursive: true, force: true });
});

describe('readUserSettings', () => {
  it('returns the defaulted envelope when the file is missing', () => {
    const got = readUserSettings();
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {} });
  });

  it('returns the defaulted envelope when the file is unparseable JSON', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, 'settings.json'), '{not json');
    const got = readUserSettings();
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {} });
  });

  it('round-trips a valid envelope', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    const onDisk = {
      schemaVersion: 1,
      updateCheck: {
        enabled: false,
        latestVersion: '0.42.0',
        checkedAt: 1_700_000_000_000,
        shownAt: 1_700_000_000_000,
      },
    };
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(onDisk));
    const got = readUserSettings();
    assert.deepEqual(got, onDisk);
  });

  it('silently defaults a payload whose schemaVersion is wrong', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 2, updateCheck: { enabled: true } }),
    );
    const got = readUserSettings();
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {} });
  });

  it('silently defaults a payload whose updateCheck.enabled is the wrong type', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, updateCheck: { enabled: 'yes' } }),
    );
    const got = readUserSettings();
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {} });
  });

  it('silently defaults a payload that carries an unknown top-level key', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, locale: 'es' }),
    );
    const got = readUserSettings();
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {} });
  });

  it('returns the defaulted envelope when the JSON root is not an object', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(['array']));
    const got = readUserSettings();
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {} });
  });
});

describe('isUpdateCheckEnabled', () => {
  it('returns true when the file is missing (opt-in default)', () => {
    assert.equal(isUpdateCheckEnabled(), true);
  });

  it('returns false only when the file explicitly opts out', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, updateCheck: { enabled: false } }),
    );
    assert.equal(isUpdateCheckEnabled(), false);
  });

  it('returns true when the file opts in explicitly', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, updateCheck: { enabled: true } }),
    );
    assert.equal(isUpdateCheckEnabled(), true);
  });
});

describe('writeUserSettings', () => {
  it('creates `~/.skill-map/settings.json` on first write', () => {
    writeUserSettings({ updateCheck: { enabled: false } });
    const onDisk = JSON.parse(readFileSync(userSettingsFilePath(), 'utf8'));
    assert.equal(onDisk.schemaVersion, 1);
    assert.equal(onDisk.updateCheck.enabled, false);
  });

  it('deep-merges patches into the existing envelope', () => {
    writeUserSettings({
      updateCheck: { latestVersion: '0.42.0', checkedAt: 1_700_000_000_000 },
    });
    writeUserSettings({ updateCheck: { enabled: false } });
    const onDisk = JSON.parse(readFileSync(userSettingsFilePath(), 'utf8'));
    assert.deepEqual(onDisk, {
      schemaVersion: 1,
      updateCheck: {
        latestVersion: '0.42.0',
        checkedAt: 1_700_000_000_000,
        enabled: false,
      },
    });
  });

  it('refuses to corrupt the on-disk file with an off-shape patch', () => {
    // Seed a valid file first.
    writeUserSettings({ updateCheck: { enabled: true } });
    const before = readFileSync(userSettingsFilePath(), 'utf8');
    // Now push an off-shape patch (enabled must be boolean). The
    // write must be a no-op, the file content stays unchanged.
    writeUserSettings({
      updateCheck: { enabled: 'yes' as unknown as boolean },
    });
    const after = readFileSync(userSettingsFilePath(), 'utf8');
    assert.equal(after, before, 'file content must be untouched');
  });

  it('refuses to corrupt the file with an unknown top-level key in the patch', () => {
    writeUserSettings({ updateCheck: { enabled: true } });
    const before = readFileSync(userSettingsFilePath(), 'utf8');
    writeUserSettings({
      // unknown key, AJV rejects with `additionalProperties: false`.
      locale: 'es',
    } as unknown as Partial<{ updateCheck: { enabled: boolean } }>);
    const after = readFileSync(userSettingsFilePath(), 'utf8');
    assert.equal(after, before, 'unknown top-level key must not land on disk');
  });
});

describe('userSettingsFilePath', () => {
  it('points to `<home>/.skill-map/settings.json`', () => {
    const got = userSettingsFilePath();
    assert.equal(got, join(homeRoot, '.skill-map', 'settings.json'));
  });
});
