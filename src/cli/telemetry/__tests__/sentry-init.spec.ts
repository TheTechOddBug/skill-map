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
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import {
  initSentryCli,
  isTelemetryActive,
  resetCliTelemetryForTests,
} from '../sentry-init.js';

/**
 * A stand-in for the `@sentry/node` namespace with spy functions, plus a
 * loader that hands it to `initSentryCli` so the init path is asserted
 * without loading the real SDK or touching the network.
 */
function makeFakeSentry() {
  return {
    init: mock.fn(),
    onUncaughtExceptionIntegration: mock.fn(() => ({ name: 'onUncaughtException' })),
    onUnhandledRejectionIntegration: mock.fn(() => ({ name: 'onUnhandledRejection' })),
  };
}

function loaderFor(fake: ReturnType<typeof makeFakeSentry>): {
  load: () => Promise<typeof import('@sentry/node')>;
  loaded: () => number;
} {
  let count = 0;
  return {
    load: () => {
      count += 1;
      return Promise.resolve(fake as unknown as typeof import('@sentry/node'));
    },
    loaded: () => count,
  };
}

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
  resetCliTelemetryForTests();
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

describe('initSentryCli (SDK spy, no network)', () => {
  it('does not load or init the SDK when consent is off', async () => {
    const fake = makeFakeSentry();
    const l = loaderFor(fake);
    await initSentryCli('1.0.0', l.load);
    assert.equal(l.loaded(), 0, 'the SDK loader must not run when inactive');
    assert.equal(fake.init.mock.callCount(), 0);
  });

  it('does not load or init the SDK when the kill switch forces off', async () => {
    optIn();
    process.env['SKILL_MAP_TELEMETRY'] = '0';
    const fake = makeFakeSentry();
    const l = loaderFor(fake);
    await initSentryCli('1.0.0', l.load);
    assert.equal(l.loaded(), 0);
    assert.equal(fake.init.mock.callCount(), 0);
  });

  it('inits with the errors-only config + cli surface tag when active', async () => {
    optIn();
    const fake = makeFakeSentry();
    await initSentryCli('9.9.9', loaderFor(fake).load);
    assert.equal(fake.init.mock.callCount(), 1);
    const opts = fake.init.mock.calls[0]?.arguments[0];
    assert.ok(opts);
    assert.equal(opts.release, 'skill-map-cli@9.9.9');
    assert.equal(opts.tracesSampleRate, 0);
    assert.equal(opts.sendDefaultPii, false);
    assert.equal(opts.registerEsmLoaderHooks, false);
    assert.equal(opts.defaultIntegrations, false);
    assert.equal(opts.initialScope.tags.surface, 'cli');
  });

  it('wires beforeSend to the path scrubber', async () => {
    optIn();
    const fake = makeFakeSentry();
    await initSentryCli('1.0.0', loaderFor(fake).load);
    const opts = fake.init.mock.calls[0]?.arguments[0];
    assert.ok(opts);
    const scrubbed = opts.beforeSend({ message: 'boom at /home/alice/secret/notes.md' });
    assert.match(scrubbed.message, /<HOME>\/secret\/notes\.md/);
    assert.doesNotMatch(scrubbed.message, /alice/);
  });

  it('is idempotent: a second call does not reload or re-init', async () => {
    optIn();
    const fake = makeFakeSentry();
    const l = loaderFor(fake);
    await initSentryCli('1.0.0', l.load);
    await initSentryCli('1.0.0', l.load);
    assert.equal(fake.init.mock.callCount(), 1);
    assert.equal(l.loaded(), 1);
  });
});
