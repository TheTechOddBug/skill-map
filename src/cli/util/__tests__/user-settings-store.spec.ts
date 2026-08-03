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
  ensureAnonymousId,
  hasSeenFirstRun,
  hasTelemetryPromptBeenShown,
  isErrorTelemetryEnabled,
  isGithubStarsEnabled,
  isUpdateCheckEnabled,
  isUsageCliTelemetryEnabled,
  isUsageUiTelemetryEnabled,
  readAnonymousId,
  readUserSettings,
  userSettingsFilePath,
  writeUserSettings,
} from '../user-settings-store.js';

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
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {}, githubStars: {}, telemetry: {} });
  });

  it('returns the defaulted envelope when the file is unparseable JSON', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, 'settings.json'), '{not json');
    const got = readUserSettings();
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {}, githubStars: {}, telemetry: {} });
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
    // The optional sub-objects are backfilled on read (derived from the
    // default envelope) so callers dereference without an existence
    // check; a preference added later rides along automatically.
    assert.deepEqual(got, { ...onDisk, githubStars: {}, telemetry: {} });
  });

  it('silently defaults a payload whose schemaVersion is wrong', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 2, updateCheck: { enabled: true } }),
    );
    const got = readUserSettings();
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {}, githubStars: {}, telemetry: {} });
  });

  it('silently defaults a payload whose updateCheck.enabled is the wrong type', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, updateCheck: { enabled: 'yes' } }),
    );
    const got = readUserSettings();
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {}, githubStars: {}, telemetry: {} });
  });

  it('silently defaults a payload that carries an unknown top-level key', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, locale: 'es' }),
    );
    const got = readUserSettings();
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {}, githubStars: {}, telemetry: {} });
  });

  it('returns the defaulted envelope when the JSON root is not an object', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(['array']));
    const got = readUserSettings();
    assert.deepEqual(got, { schemaVersion: 1, updateCheck: {}, githubStars: {}, telemetry: {} });
  });
});

describe('writeUserSettings merge', () => {
  /**
   * Regression: the merge used to enumerate the sub-objects by hand
   * (`updateCheck`, `telemetry`), so a NEW preference was dropped on the
   * floor. The write reported success, the key never reached disk, and
   * the toggle sprang back to its default on the next read, which is
   * exactly how the star-count switch shipped broken. These tests treat
   * "a key the merge was not told about" as the thing under test.
   */
  it('persists a sub-object the merge was never taught about', () => {
    writeUserSettings({ githubStars: { enabled: false } });

    assert.equal(readUserSettings().githubStars?.enabled, false);
    assert.equal(isGithubStarsEnabled(), false);
  });

  it('round-trips a flip back on', () => {
    writeUserSettings({ githubStars: { enabled: false } });
    writeUserSettings({ githubStars: { enabled: true } });

    assert.equal(isGithubStarsEnabled(), true);
  });

  it('leaves the other sub-objects untouched', () => {
    writeUserSettings({ updateCheck: { enabled: false, latestVersion: '9.9.9' } });
    writeUserSettings({ githubStars: { enabled: false } });

    const got = readUserSettings();
    assert.equal(got.updateCheck?.enabled, false);
    assert.equal(got.updateCheck?.latestVersion, '9.9.9');
    assert.equal(got.githubStars?.enabled, false);
  });

  it('merges INTO a sub-object rather than replacing it', () => {
    writeUserSettings({ updateCheck: { latestVersion: '1.0.0', checkedAt: 42 } });
    writeUserSettings({ updateCheck: { enabled: false } });

    const got = readUserSettings();
    // The partial patch must not wipe the sibling bookkeeping.
    assert.equal(got.updateCheck?.latestVersion, '1.0.0');
    assert.equal(got.updateCheck?.checkedAt, 42);
    assert.equal(got.updateCheck?.enabled, false);
  });

  it('never lets a caller move the shape version', () => {
    writeUserSettings({ schemaVersion: 99 as 1, githubStars: { enabled: false } });

    assert.equal(readUserSettings().schemaVersion, 1);
  });
});

describe('isGithubStarsEnabled', () => {
  /** Same default-ON posture as the update check: it reads a public
   *  number, it does not report anything about the operator. */
  it('returns true when the file is missing', () => {
    assert.equal(isGithubStarsEnabled(), true);
  });

  it('returns false only when the file explicitly opts out', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, githubStars: { enabled: false } }),
    );
    assert.equal(isGithubStarsEnabled(), false);
  });

  it('is independent of the update-check toggle', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, updateCheck: { enabled: false } }),
    );
    assert.equal(isGithubStarsEnabled(), true);
    assert.equal(isUpdateCheckEnabled(), false);
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

describe('isErrorTelemetryEnabled', () => {
  it('returns false when the file is missing (opt-OUT default)', () => {
    assert.equal(isErrorTelemetryEnabled(), false);
  });

  it('returns false when telemetry is present but errorsEnabled is absent', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, telemetry: { promptedAt: 1 } }),
    );
    assert.equal(isErrorTelemetryEnabled(), false);
  });

  it('returns true only when errorsEnabled is explicitly true', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, telemetry: { errorsEnabled: true } }),
    );
    assert.equal(isErrorTelemetryEnabled(), true);
  });
});

describe('hasTelemetryPromptBeenShown', () => {
  it('returns false when the file is missing', () => {
    assert.equal(hasTelemetryPromptBeenShown(), false);
  });

  it('returns true once promptedAt is a number', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, telemetry: { promptedAt: 1_700_000_000_000 } }),
    );
    assert.equal(hasTelemetryPromptBeenShown(), true);
  });
});

describe('hasSeenFirstRun', () => {
  it('returns false when the file is missing', () => {
    assert.equal(hasSeenFirstRun(), false);
  });

  it('returns true once firstRunAt is a number', () => {
    const settingsDir = join(homeRoot, '.skill-map');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, telemetry: { firstRunAt: 1_700_000_000_000 } }),
    );
    assert.equal(hasSeenFirstRun(), true);
  });

  it('a firstRunAt patch merges without clobbering errorsEnabled', () => {
    writeUserSettings({ telemetry: { errorsEnabled: true } });
    writeUserSettings({ telemetry: { firstRunAt: 1_700_000_000_000 } });
    const onDisk = JSON.parse(readFileSync(userSettingsFilePath(), 'utf8'));
    assert.deepEqual(onDisk.telemetry, {
      errorsEnabled: true,
      firstRunAt: 1_700_000_000_000,
    });
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
      // Backfilled by the reader (derived from the default envelope),
      // so an empty sub-object rides along even when untouched.
      githubStars: {},
      telemetry: {},
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

  it('merges a telemetry patch independently of updateCheck', () => {
    writeUserSettings({ updateCheck: { enabled: false } });
    writeUserSettings({ telemetry: { errorsEnabled: true, promptedAt: 1_700_000_000_000 } });
    const onDisk = JSON.parse(readFileSync(userSettingsFilePath(), 'utf8'));
    assert.deepEqual(onDisk, {
      schemaVersion: 1,
      updateCheck: { enabled: false },
      githubStars: {},
      telemetry: { errorsEnabled: true, promptedAt: 1_700_000_000_000 },
    });
  });

  it('refuses to corrupt the file with an off-shape telemetry patch', () => {
    writeUserSettings({ telemetry: { errorsEnabled: true } });
    const before = readFileSync(userSettingsFilePath(), 'utf8');
    writeUserSettings({
      telemetry: { errorsEnabled: 'yes' as unknown as boolean },
    });
    const after = readFileSync(userSettingsFilePath(), 'utf8');
    assert.equal(after, before, 'off-shape telemetry patch must be a no-op');
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

describe('usage telemetry readers', () => {
  function seed(telemetry: Record<string, unknown>): void {
    mkdirSync(join(homeRoot, '.skill-map'), { recursive: true });
    writeFileSync(
      join(homeRoot, '.skill-map', 'settings.json'),
      JSON.stringify({ schemaVersion: 1, telemetry }),
    );
  }

  it('isUsageCliTelemetryEnabled / isUsageUiTelemetryEnabled are OFF by default', () => {
    assert.equal(isUsageCliTelemetryEnabled(), false);
    assert.equal(isUsageUiTelemetryEnabled(), false);
  });

  it('each usage toggle reads independently', () => {
    seed({ usageCliEnabled: true, usageUiEnabled: false });
    assert.equal(isUsageCliTelemetryEnabled(), true);
    assert.equal(isUsageUiTelemetryEnabled(), false);
  });

  it('readAnonymousId returns null until one is minted', () => {
    assert.equal(readAnonymousId(), null);
    seed({ anonymousId: 'abc-123' });
    assert.equal(readAnonymousId(), 'abc-123');
  });
});

describe('ensureAnonymousId', () => {
  it('mints + persists an id on first call, returns it unchanged thereafter', () => {
    let calls = 0;
    const generate = (): string => {
      calls += 1;
      return `minted-${calls}`;
    };
    const first = ensureAnonymousId(generate);
    assert.equal(first, 'minted-1');
    assert.equal(readAnonymousId(), 'minted-1', 'persisted to disk');

    // A second call must NOT rotate the id (no new generation, no rewrite).
    const second = ensureAnonymousId(generate);
    assert.equal(second, 'minted-1');
    assert.equal(calls, 1, 'generator is invoked exactly once');
  });
});
