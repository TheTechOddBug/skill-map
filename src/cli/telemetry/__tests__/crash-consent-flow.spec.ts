/**
 * Integration tests for the per-incident crash-report FLOW
 * (`maybeOfferCrashReport`): real readline IO over fake streams, persisted
 * consent via a HOME-redirected tempdir, and an injected fake SDK loader so
 * nothing is ever loaded from `@sentry/node` or sent anywhere.
 *
 * Pins the decided model: the prompt appears on every promptable crash with
 * a flat Yes default (Enter, EOF, and the bounded wait all send; an explicit
 * no always wins), the persisted toggle governs only the non-promptable
 * fallback, and NOTHING is persisted from the answer.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import {
  maybeOfferCrashReport,
  resetCrashConsentForTests,
  setCrashConsentSdkLoaderForTests,
} from '../crash-consent.js';
import { resetCliTelemetryForTests } from '../sentry-init.js';

let homeRoot: string;
let originalHome: string | undefined;
let originalUserprofile: string | undefined;
let originalCi: string | undefined;
let originalKill: string | undefined;

const SETTINGS = () => join(homeRoot, '.skill-map', 'settings.json');

interface IFakeStreams {
  stdin: PassThrough & { isTTY?: boolean };
  stderr: PassThrough & { isTTY?: boolean };
  out: () => string;
}

/**
 * Fake interactive streams. `answers` are fed to readline one per line and
 * the stream is ended (EOF) unless `keepOpen`; both ends default to TTY.
 */
function makeStreams(answers: string[] = [], opts: { keepOpen?: boolean; tty?: boolean } = {}): IFakeStreams {
  const tty = opts.tty ?? true;
  const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
  const stderr = new PassThrough() as PassThrough & { isTTY?: boolean };
  stdin.isTTY = tty;
  stderr.isTTY = tty;
  let buf = '';
  stderr.on('data', (c) => {
    buf += c.toString();
  });
  for (const a of answers) stdin.write(`${a}\n`);
  if (opts.keepOpen !== true) stdin.end();
  return { stdin, stderr, out: () => buf };
}

function makeFakeSentry(flushResult = true) {
  return {
    init: mock.fn(),
    setTag: mock.fn(),
    captureException: mock.fn(),
    flush: mock.fn(() => Promise.resolve(flushResult)),
    close: mock.fn(() => Promise.resolve(true)),
  };
}

function armFakeLoader(fake: ReturnType<typeof makeFakeSentry>): { loaded: () => number } {
  let count = 0;
  setCrashConsentSdkLoaderForTests(() => {
    count += 1;
    return Promise.resolve(fake as unknown as typeof import('@sentry/node'));
  });
  return { loaded: () => count };
}

function seed(telemetry: Record<string, unknown>): void {
  mkdirSync(join(homeRoot, '.skill-map'), { recursive: true });
  writeFileSync(SETTINGS(), JSON.stringify({ schemaVersion: 1, telemetry }));
}

const BOOM = new Error('flow boom');

function offer(
  streams: IFakeStreams,
  opts: Partial<Parameters<typeof maybeOfferCrashReport>[1]> = {},
): ReturnType<typeof maybeOfferCrashReport> {
  return maybeOfferCrashReport(BOOM, {
    stdin: streams.stdin,
    stderr: streams.stderr,
    json: false,
    quiet: false,
    noColor: true,
    verb: 'scan',
    level: 'error',
    ...opts,
  });
}

before(() => {
  homeRoot = mkdtempSync(join(tmpdir(), 'skill-map-crash-flow-'));
  originalHome = process.env['HOME'];
  originalUserprofile = process.env['USERPROFILE'];
  originalCi = process.env['CI'];
  originalKill = process.env['SKILL_MAP_TELEMETRY'];
  process.env['HOME'] = homeRoot;
  process.env['USERPROFILE'] = homeRoot;
});

after(() => {
  restore('HOME', originalHome);
  restore('USERPROFILE', originalUserprofile);
  restore('CI', originalCi);
  restore('SKILL_MAP_TELEMETRY', originalKill);
  rmSync(homeRoot, { recursive: true, force: true });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  rmSync(join(homeRoot, '.skill-map'), { recursive: true, force: true });
  // The test scripts pin SKILL_MAP_TELEMETRY=0 and CI sets CI=true; the
  // flow needs both unset to reach the promptable path. The injected fake
  // loader guarantees nothing real is ever sent.
  delete process.env['CI'];
  delete process.env['SKILL_MAP_TELEMETRY'];
  resetCliTelemetryForTests();
  resetCrashConsentForTests();
});

afterEach(() => {
  delete process.env['CI'];
  delete process.env['SKILL_MAP_TELEMETRY'];
  resetCrashConsentForTests();
  resetCliTelemetryForTests();
});

describe('maybeOfferCrashReport (prompt path)', () => {
  it('empty Enter takes the flat Yes default and sends through the loader', async () => {
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const s = makeStreams(['']);
    const outcome = await offer(s);
    assert.equal(outcome, 'sent');
    assert.equal(l.loaded(), 1);
    assert.equal(fake.captureException.mock.callCount(), 1);
    assert.match(s.out(), /Send this report\?/);
    assert.match(s.out(), /Crash report sent/);
  });

  it('the default is Yes even with an explicit persisted opt-out', async () => {
    seed({ errorsEnabled: false });
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const s = makeStreams(['']);
    const outcome = await offer(s);
    assert.equal(outcome, 'sent');
    assert.equal(l.loaded(), 1);
  });

  it('an explicit no always wins and loads nothing', async () => {
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const s = makeStreams(['n']);
    const outcome = await offer(s);
    assert.equal(outcome, 'declined');
    assert.equal(l.loaded(), 0);
    assert.match(s.out(), /Not sent\./);
  });

  it('[d]etails prints the scrubbed preview, then the re-ask honours the answer', async () => {
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    // Answers are written SPACED (not pre-buffered): two lines in one chunk
    // land before the re-ask registers its listener, the second is dropped,
    // and EOF would resolve the re-ask to the Yes default, sending.
    const s = makeStreams([], { keepOpen: true });
    const pending = offer(s);
    s.stdin.write('d\n');
    await new Promise((r) => setTimeout(r, 100));
    s.stdin.write('n\n');
    const outcome = await pending;
    assert.equal(outcome, 'declined');
    assert.equal(l.loaded(), 0);
    assert.match(s.out(), /after scrubbing/);
    assert.match(s.out(), /flow boom/);
    assert.doesNotMatch(s.out(), new RegExp(homeRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('stdin EOF resolves to the Yes default without hanging', async () => {
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const s = makeStreams([]);
    const outcome = await offer(s);
    assert.equal(outcome, 'sent');
    assert.equal(l.loaded(), 1);
  });

  it('the bounded wait resolves to the Yes default on a silent terminal', async () => {
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const s = makeStreams([], { keepOpen: true });
    const outcome = await offer(s, { timeoutMs: 50 });
    assert.equal(outcome, 'sent');
    assert.equal(l.loaded(), 1);
    assert.match(s.out(), /auto-answers yes/);
  });

  it('persists NOTHING: the settings file is untouched by a yes', async () => {
    seed({ errorsEnabled: false });
    const before_ = readFileSync(SETTINGS(), 'utf8');
    const fake = makeFakeSentry();
    armFakeLoader(fake);
    const s = makeStreams(['y']);
    await offer(s);
    assert.equal(readFileSync(SETTINGS(), 'utf8'), before_);
  });

  it('reports send-failed when the transport flush times out', async () => {
    const fake = makeFakeSentry(false);
    armFakeLoader(fake);
    const s = makeStreams(['y']);
    const outcome = await offer(s);
    assert.equal(outcome, 'send-failed');
    assert.match(s.out(), /Could not send/);
  });
});

describe('maybeOfferCrashReport (fallback + hard gates)', () => {
  it('non-TTY with persisted opt-in auto-sends without a question', async () => {
    seed({ errorsEnabled: true });
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const s = makeStreams([], { tty: false });
    const outcome = await offer(s);
    assert.equal(outcome, 'sent');
    assert.equal(l.loaded(), 1);
    assert.doesNotMatch(s.out(), /Send this report\?/);
  });

  it('non-TTY without opt-in stays silent', async () => {
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const s = makeStreams([], { tty: false });
    const outcome = await offer(s);
    assert.equal(outcome, 'skipped');
    assert.equal(l.loaded(), 0);
    assert.equal(s.out(), '');
  });

  it('--json suppresses the prompt even on a TTY', async () => {
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const s = makeStreams(['y']);
    const outcome = await offer(s, { json: true });
    assert.equal(outcome, 'skipped');
    assert.equal(l.loaded(), 0);
  });

  it('the kill switch silences everything, even a would-be prompt', async () => {
    process.env['SKILL_MAP_TELEMETRY'] = '0';
    seed({ errorsEnabled: true });
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const s = makeStreams(['y']);
    const outcome = await offer(s);
    assert.equal(outcome, 'skipped');
    assert.equal(l.loaded(), 0);
    assert.equal(s.out(), '');
  });

  it('the serve verb never prompts nor sends from the CLI side', async () => {
    seed({ errorsEnabled: true });
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const s = makeStreams(['y']);
    const outcome = await offer(s, { verb: 'serve' });
    assert.equal(outcome, 'skipped');
    assert.equal(l.loaded(), 0);
  });

  it('never writes the settings file at all (no bookkeeping side effects)', async () => {
    const fake = makeFakeSentry();
    armFakeLoader(fake);
    const s = makeStreams(['n']);
    await offer(s);
    assert.equal(existsSync(SETTINGS()), false);
  });
});
