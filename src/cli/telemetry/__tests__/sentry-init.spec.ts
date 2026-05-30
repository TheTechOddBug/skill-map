/**
 * Unit tests for the CLI telemetry gate (`cli/telemetry/sentry-init.ts`).
 * Only the pure `isTelemetryActive` decision is exercised: it is the gate
 * `initSentryCli` consults, and it must stay OFF unless every condition
 * (no kill switch, real DSN, explicit consent) holds. No SDK is started
 * and no network is touched.
 *
 * Consent is controlled by redirecting HOME to a tempdir (the user-settings
 * store is the only legitimate `os.homedir()` reader) and writing the file.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { isTelemetryActive } from '../sentry-init.js';

const FAKE_DSN = 'https://abc123@o0.ingest.sentry.io/1';

let homeRoot: string;
let originalHome: string | undefined;
let originalUserprofile: string | undefined;
let originalKill: string | undefined;

function optIn(): void {
  const dir = join(homeRoot, '.skill-map');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ schemaVersion: 1, telemetry: { errorsEnabled: true } }),
  );
}

before(() => {
  homeRoot = mkdtempSync(join(tmpdir(), 'skill-map-sentry-gate-'));
  originalHome = process.env['HOME'];
  originalUserprofile = process.env['USERPROFILE'];
  originalKill = process.env['SKILL_MAP_TELEMETRY'];
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

beforeEach(() => {
  rmSync(join(homeRoot, '.skill-map'), { recursive: true, force: true });
  delete process.env['SKILL_MAP_TELEMETRY'];
});

afterEach(() => {
  if (originalKill === undefined) delete process.env['SKILL_MAP_TELEMETRY'];
  else process.env['SKILL_MAP_TELEMETRY'] = originalKill;
});

describe('isTelemetryActive', () => {
  it('is false with the empty placeholder DSN even after opt-in', () => {
    optIn();
    assert.equal(isTelemetryActive(''), false);
  });

  it('is false by default (no consent recorded)', () => {
    assert.equal(isTelemetryActive(FAKE_DSN), false);
  });

  it('is true with a real DSN and explicit opt-in', () => {
    optIn();
    assert.equal(isTelemetryActive(FAKE_DSN), true);
  });

  it('is false when the kill switch SKILL_MAP_TELEMETRY=0 is set, despite opt-in', () => {
    optIn();
    process.env['SKILL_MAP_TELEMETRY'] = '0';
    assert.equal(isTelemetryActive(FAKE_DSN), false);
  });

  it('is true when the kill switch is set to a non-zero value and opted in', () => {
    optIn();
    process.env['SKILL_MAP_TELEMETRY'] = '1';
    // Only the literal "0" is the kill switch; any other value is ignored.
    assert.equal(isTelemetryActive(FAKE_DSN), true);
  });

  it('is false when the operator explicitly opted out', () => {
    const dir = join(homeRoot, '.skill-map');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ schemaVersion: 1, telemetry: { errorsEnabled: false } }),
    );
    assert.equal(isTelemetryActive(FAKE_DSN), false);
  });
});
