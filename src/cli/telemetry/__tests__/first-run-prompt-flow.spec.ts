/**
 * Integration tests for the consent-prompt FLOW (`maybeRunFirstRunPrompt`),
 * exercising the real readline IO + the persisted user-settings, but never
 * touching Sentry (the prompt only reads/writes `~/.skill-map/settings.json`
 * and talks to the injected streams). HOME is redirected to a tempdir so the
 * developer's real settings are untouched.
 *
 * Covers the second-run deferral: the first eligible run stamps `firstRunAt`
 * and stays silent; the next eligible run shows the prompt and persists the
 * choice; non-eligible runs do nothing.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { maybeRunFirstRunPrompt } from '../first-run-prompt.js';

let homeRoot: string;
let originalHome: string | undefined;
let originalUserprofile: string | undefined;
let originalCi: string | undefined;
let originalKill: string | undefined;

const SETTINGS = () => join(homeRoot, '.skill-map', 'settings.json');

/** Fake interactive streams. `answers` are fed to readline, one per line. */
function makeStreams(answers: string[] = []): {
  stdin: PassThrough;
  stdout: PassThrough & { isTTY?: boolean };
  out: () => string;
} {
  const stdin = new PassThrough();
  const stdout = new PassThrough() as PassThrough & { isTTY?: boolean };
  stdout.isTTY = true;
  let buf = '';
  stdout.on('data', (c) => {
    buf += c.toString();
  });
  for (const a of answers) stdin.write(`${a}\n`);
  // End the stream so readline sees EOF after the queued answers and the
  // interface closes cleanly (otherwise the test process never exits).
  stdin.end();
  return { stdin, stdout, out: () => buf };
}

function seed(telemetry: Record<string, unknown>): void {
  mkdirSync(join(homeRoot, '.skill-map'), { recursive: true });
  writeFileSync(SETTINGS(), JSON.stringify({ schemaVersion: 1, telemetry }));
}

function readTelemetry(): {
  errorsEnabled?: boolean;
  usageCliEnabled?: boolean;
  usageUiEnabled?: boolean;
  anonymousId?: string;
  promptedAt?: number;
  firstRunAt?: number;
} {
  return JSON.parse(readFileSync(SETTINGS(), 'utf8')).telemetry;
}

before(() => {
  homeRoot = mkdtempSync(join(tmpdir(), 'skill-map-prompt-flow-'));
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
  // The test scripts pin SKILL_MAP_TELEMETRY=0; the prompt flow needs it
  // unset (and CI unset) to reach the eligible path. The prompt never emits
  // telemetry, so this is safe.
  delete process.env['CI'];
  delete process.env['SKILL_MAP_TELEMETRY'];
});

afterEach(() => {
  delete process.env['CI'];
  delete process.env['SKILL_MAP_TELEMETRY'];
});

describe('maybeRunFirstRunPrompt (second-run deferral)', () => {
  it('first eligible run: stamps firstRunAt and does NOT prompt', async () => {
    const { stdin, stdout, out } = makeStreams();
    await maybeRunFirstRunPrompt({ stdin, stdout, nowMs: 111 });
    assert.equal(out(), '', 'no question should be written on the first run');
    assert.deepEqual(readTelemetry(), { firstRunAt: 111 });
  });

  it('second eligible run: prompts and persists opt-in (all three toggles + id) on "y"', async () => {
    seed({ firstRunAt: 111 });
    const { stdin, stdout, out } = makeStreams(['y']);
    await maybeRunFirstRunPrompt({ stdin, stdout, nowMs: 222 });
    assert.match(out(), /Enable anonymous error and usage reporting/);
    const t = readTelemetry();
    // One answer consents to every surface and mints the anonymous usage id
    // (a random UUID, so asserted by type rather than value).
    assert.equal(t.firstRunAt, 111);
    assert.equal(t.promptedAt, 222);
    assert.equal(t.errorsEnabled, true);
    assert.equal(t.usageCliEnabled, true);
    assert.equal(t.usageUiEnabled, true);
    assert.equal(typeof t.anonymousId, 'string');
    assert.ok((t.anonymousId ?? '').length > 0);
  });

  it('second eligible run: persists opt-OUT on all surfaces (no id minted) on "n"', async () => {
    seed({ firstRunAt: 111 });
    const { stdin, stdout } = makeStreams(['n']);
    await maybeRunFirstRunPrompt({ stdin, stdout, nowMs: 222 });
    const t = readTelemetry();
    assert.equal(t.errorsEnabled, false);
    assert.equal(t.usageCliEnabled, false);
    assert.equal(t.usageUiEnabled, false);
    assert.equal(t.anonymousId, undefined, 'no distinct_id is minted on a decline');
  });

  it('second eligible run: empty Enter takes the [Y]es default (opt-in everywhere)', async () => {
    seed({ firstRunAt: 111 });
    const { stdin, stdout } = makeStreams(['']);
    await maybeRunFirstRunPrompt({ stdin, stdout, nowMs: 333 });
    const t = readTelemetry();
    assert.equal(t.errorsEnabled, true);
    assert.equal(t.usageCliEnabled, true);
    assert.equal(t.usageUiEnabled, true);
    assert.equal(typeof t.anonymousId, 'string');
  });

  it('never prompts again once promptedAt is set', async () => {
    seed({ firstRunAt: 111, errorsEnabled: false, promptedAt: 222 });
    const { stdin, stdout, out } = makeStreams(['y']);
    await maybeRunFirstRunPrompt({ stdin, stdout, nowMs: 999 });
    assert.equal(out(), '', 'no prompt once already answered');
    assert.equal(readTelemetry().errorsEnabled, false, 'the prior choice is authoritative');
  });

  it('non-TTY run: never prompts and never records anything', async () => {
    const { stdin, stdout, out } = makeStreams(['y']);
    stdout.isTTY = false;
    await maybeRunFirstRunPrompt({ stdin, stdout, nowMs: 111 });
    assert.equal(out(), '');
    assert.equal(existsSync(SETTINGS()), false, 'nothing written on a non-eligible run');
  });

  it('kill switch SKILL_MAP_TELEMETRY=0: never prompts and never records', async () => {
    process.env['SKILL_MAP_TELEMETRY'] = '0';
    const { stdin, stdout, out } = makeStreams(['y']);
    await maybeRunFirstRunPrompt({ stdin, stdout, nowMs: 111 });
    assert.equal(out(), '');
    assert.equal(existsSync(SETTINGS()), false);
  });
});
