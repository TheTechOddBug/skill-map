/**
 * Guard for the `SmCommand.execute()` crash-consent wiring: a throw
 * escaping a verb's `run()` renders the §3.1b error block, exits 2, and
 * runs the per-incident crash-report flow, without the flow ever being able
 * to change the exit code or leak prompt bytes into a machine-facing run.
 *
 * Uses dummy throwing commands through Clipanion's `Cli.run` (pattern:
 * `fatal-path-channels.spec.ts`) with captured non-TTY streams, a
 * HOME-redirected tempdir, and the injected fake SDK loader seam so nothing
 * real is ever sent.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { SmCommand } from '../../util/sm-command.js';
import { ExitCode } from '../../util/exit-codes.js';
import { DbSchemaDriftError } from '../../../core/sqlite/db-version-check.js';
import {
  resetCrashConsentForTests,
  setCrashConsentSdkLoaderForTests,
} from '../../telemetry/crash-consent.js';
import { resetCliTelemetryForTests } from '../../telemetry/sentry-init.js';

class BoomCommand extends SmCommand {
  static override paths = [['boom']];
  protected async run(): Promise<number> {
    throw new Error('boundary boom');
  }
}

class DeepBoomCommand extends SmCommand {
  static override paths = [['boom', 'deep']];
  protected async run(): Promise<number> {
    throw new Error('deep boundary boom');
  }
}

class AdvisoryCommand extends SmCommand {
  static override paths = [['advisory']];
  protected async run(): Promise<number> {
    throw new DbSchemaDriftError({
      message: 'drift',
      humanMessage: 'schema drifted, run sm scan\n',
    });
  }
}

interface ICapture {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapture {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdin = new PassThrough() as PassThrough & { isTTY?: boolean };
  stdin.isTTY = false;
  stdin.end();
  const context = {
    stdin,
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

function buildCli(): Cli {
  const cli = new Cli({ binaryName: 'sm', binaryLabel: 'skill-map', binaryVersion: '0.0.0' });
  cli.register(BoomCommand);
  cli.register(DeepBoomCommand);
  cli.register(AdvisoryCommand);
  return cli;
}

function makeFakeSentry() {
  return {
    init: mock.fn(),
    setTag: mock.fn(),
    captureException: mock.fn(),
    flush: mock.fn(() => Promise.resolve(true)),
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

let homeRoot: string;
let originalHome: string | undefined;
let originalUserprofile: string | undefined;
let originalCi: string | undefined;
let originalKill: string | undefined;

function seedOptIn(): void {
  const dir = join(homeRoot, '.skill-map');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ schemaVersion: 1, telemetry: { errorsEnabled: true } }),
  );
}

before(() => {
  homeRoot = mkdtempSync(join(tmpdir(), 'skill-map-crash-boundary-'));
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

describe('SmCommand boundary + crash-consent wiring', () => {
  it('non-TTY without opt-in: exit 2, error block on stderr, no prompt, no send', async () => {
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const cap = captureContext();
    const exit = await buildCli().run(['boom'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /boundary boom/);
    assert.doesNotMatch(cap.stderr(), /Send this report\?/);
    assert.equal(l.loaded(), 0);
  });

  it('non-TTY with persisted opt-in: auto-sends through the seam, exit stays 2', async () => {
    seedOptIn();
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const cap = captureContext();
    const exit = await buildCli().run(['boom'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.equal(l.loaded(), 1);
    assert.equal(fake.captureException.mock.callCount(), 1);
    // The hydrated Clipanion path reaches the report as the verb tag.
    assert.deepEqual(fake.setTag.mock.calls[0]?.arguments, ['verb', 'boom']);
  });

  it('a two-token verb reaches the report joined by a space', async () => {
    seedOptIn();
    const fake = makeFakeSentry();
    armFakeLoader(fake);
    const cap = captureContext();
    await buildCli().run(['boom', 'deep'], cap.context);
    assert.deepEqual(fake.setTag.mock.calls[0]?.arguments, ['verb', 'boom deep']);
  });

  it('--json keeps stdout clean for the machine consumer and still auto-sends', async () => {
    seedOptIn();
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const cap = captureContext();
    const exit = await buildCli().run(['boom', '--json'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.equal(cap.stdout(), '');
    assert.doesNotMatch(cap.stderr(), /Send this report\?/);
    assert.equal(l.loaded(), 1);
  });

  it('typed operator advisories never reach the crash flow', async () => {
    seedOptIn();
    const fake = makeFakeSentry();
    const l = armFakeLoader(fake);
    const cap = captureContext();
    const exit = await buildCli().run(['advisory'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /schema drifted/);
    assert.equal(l.loaded(), 0, 'an advisory is not a crash');
  });
});
