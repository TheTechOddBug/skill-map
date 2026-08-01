/**
 * Unit tests for the CLI Sentry gate + one-shot sender
 * (`cli/telemetry/sentry-init.ts`).
 *
 * The pure gates (`isTelemetryActive`, `telemetryInactiveReason`) and the
 * consent-resolved sender (`sendCrashReportOnce`) are exercised with an
 * injected fake SDK loader, so no real SDK is loaded and no network is
 * touched. The key semantic pinned here: `sendCrashReportOnce` does NOT
 * re-check consent (the per-incident prompt IS the consent); only the two
 * hard gates (kill switch, dormant DSN) block it.
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
  isTelemetryActive,
  resetCliTelemetryForTests,
  sendCrashReportOnce,
  telemetryInactiveReason,
} from '../sentry-init.js';
import { VERSION } from '../../../version.js';

/**
 * A stand-in for the `@sentry/node` namespace with spy functions, plus a
 * loader that hands it to `sendCrashReportOnce` so the arm/capture path is
 * asserted without loading the real SDK or touching the network.
 */
function makeFakeSentry(flushResult = true) {
  return {
    init: mock.fn(),
    setTag: mock.fn(),
    captureException: mock.fn(),
    flush: mock.fn(() => Promise.resolve(flushResult)),
    close: mock.fn(() => Promise.resolve(true)),
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

describe('telemetryInactiveReason', () => {
  it('is null when every gate is open', () => {
    optIn();
    assert.equal(telemetryInactiveReason(FAKE_DSN), null);
  });

  it('names the consent gate when nothing was recorded', () => {
    assert.equal(telemetryInactiveReason(FAKE_DSN), 'no-consent');
  });

  it('names the dormant DSN even after opt-in', () => {
    optIn();
    assert.equal(telemetryInactiveReason(''), 'dsn-dormant');
  });

  it('names the kill switch first, it overrides the other gates', () => {
    optIn();
    process.env['SKILL_MAP_TELEMETRY'] = '0';
    assert.equal(telemetryInactiveReason(FAKE_DSN), 'kill-switch');
    // Precedence: the switch wins over a dormant DSN too.
    assert.equal(telemetryInactiveReason(''), 'kill-switch');
  });
});

describe('sendCrashReportOnce (SDK spy, no network)', () => {
  const boom = new Error('boom');

  it('sends WITHOUT persisted consent: the per-incident answer is the consent', async () => {
    // No settings file at all: under the old model this refused; under
    // per-incident consent the caller already resolved the yes.
    const fake = makeFakeSentry();
    const l = loaderFor(fake);
    const ok = await sendCrashReportOnce(boom, { verb: 'scan', level: 'error', loadSdk: l.load });
    assert.equal(ok, true);
    assert.equal(l.loaded(), 1);
    assert.equal(fake.captureException.mock.callCount(), 1);
  });

  it('refuses under the kill switch without loading the SDK', async () => {
    optIn();
    process.env['SKILL_MAP_TELEMETRY'] = '0';
    const fake = makeFakeSentry();
    const l = loaderFor(fake);
    const ok = await sendCrashReportOnce(boom, { verb: 'scan', level: 'error', loadSdk: l.load });
    assert.equal(ok, false);
    assert.equal(l.loaded(), 0);
  });

  it('arms with the errors-only, no-auto-capture config', async () => {
    const fake = makeFakeSentry();
    await sendCrashReportOnce(boom, { verb: 'scan', level: 'error', loadSdk: loaderFor(fake).load });
    assert.equal(fake.init.mock.callCount(), 1);
    const opts = fake.init.mock.calls[0]?.arguments[0];
    assert.ok(opts);
    assert.equal(opts.release, `skill-map-cli@${VERSION}`);
    assert.equal(opts.tracesSampleRate, 0);
    assert.equal(opts.sendDefaultPii, false);
    assert.equal(opts.registerEsmLoaderHooks, false);
    assert.equal(opts.defaultIntegrations, false);
    // The consent prompt owns capture; the SDK must never auto-capture.
    assert.deepEqual(opts.integrations, []);
    assert.equal(opts.initialScope.tags.surface, 'cli');
  });

  it('wires beforeSend to the path scrubber', async () => {
    const fake = makeFakeSentry();
    await sendCrashReportOnce(boom, { verb: '', level: 'error', loadSdk: loaderFor(fake).load });
    const opts = fake.init.mock.calls[0]?.arguments[0];
    assert.ok(opts);
    const scrubbed = opts.beforeSend({ message: 'boom at /home/alice/secret/notes.md' });
    assert.match(scrubbed.message, /<HOME>\/secret\/notes\.md/);
    assert.doesNotMatch(scrubbed.message, /alice/);
  });

  it('tags the verb, captures with the level, and flushes bounded', async () => {
    const fake = makeFakeSentry();
    await sendCrashReportOnce(boom, { verb: 'db dump', level: 'fatal', loadSdk: loaderFor(fake).load });
    assert.deepEqual(fake.setTag.mock.calls[0]?.arguments, ['verb', 'db dump']);
    const [captured, ctx] = fake.captureException.mock.calls[0]?.arguments ?? [];
    assert.equal(captured, boom);
    assert.deepEqual(ctx, { level: 'fatal' });
    assert.deepEqual(fake.flush.mock.calls[0]?.arguments, [3_000]);
  });

  it('skips the verb tag when the verb is unknown', async () => {
    const fake = makeFakeSentry();
    await sendCrashReportOnce(boom, { verb: '', level: 'error', loadSdk: loaderFor(fake).load });
    assert.equal(fake.setTag.mock.callCount(), 0);
  });

  it('arms once across two sends (cached client, loader runs once)', async () => {
    const fake = makeFakeSentry();
    const l = loaderFor(fake);
    await sendCrashReportOnce(boom, { verb: 'scan', level: 'error', loadSdk: l.load });
    await sendCrashReportOnce(boom, { verb: 'scan', level: 'fatal', loadSdk: l.load });
    assert.equal(l.loaded(), 1);
    assert.equal(fake.init.mock.callCount(), 1);
    assert.equal(fake.captureException.mock.callCount(), 2);
  });

  it('reports false when the transport flush times out', async () => {
    const fake = makeFakeSentry(false);
    const ok = await sendCrashReportOnce(boom, { verb: 'scan', level: 'error', loadSdk: loaderFor(fake).load });
    assert.equal(ok, false);
  });
});
