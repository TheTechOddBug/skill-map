/**
 * Guard for the hard-gate refusal of the hidden Sentry self-test verb
 * (`cli/commands/intentional-fail.ts`).
 *
 * Under per-incident crash-report consent (spec/telemetry.md) the verb only
 * refuses on the two HARD gates (`SKILL_MAP_TELEMETRY=0`, dormant DSN);
 * missing consent no longer refuses, the crash-report prompt is the consent.
 *
 * Every in-process case here runs UNDER THE KILL SWITCH on purpose: without
 * a closed hard gate the verb's deferred throw is a real uncaught exception
 * and would take the test runner down with it. The crash + prompt behaviour
 * is covered by the spawn-based `src/cli/__tests__/fatal-crash-consent.spec.ts`.
 * HOME is redirected to a tempdir so the developer's real
 * `~/.skill-map/settings.json` can never leak into the run.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { Cli } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { IntentionalFailCommand } from '../intentional-fail.js';
import { ExitCode } from '../../util/exit-codes.js';

interface ICapture {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapture {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdin: process.stdin,
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
  cli.register(IntentionalFailCommand);
  return cli;
}

let homeRoot: string;
let originalHome: string | undefined;
let originalUserprofile: string | undefined;
let originalKill: string | undefined;

before(() => {
  homeRoot = mkdtempSync(join(tmpdir(), 'skill-map-intentional-fail-'));
  originalHome = process.env['HOME'];
  originalUserprofile = process.env['USERPROFILE'];
  originalKill = process.env['SKILL_MAP_TELEMETRY'];
  process.env['HOME'] = homeRoot;
  process.env['USERPROFILE'] = homeRoot;
  // Hard gate closed for EVERY in-process case; see the header.
  process.env['SKILL_MAP_TELEMETRY'] = '0';
});

after(() => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  if (originalUserprofile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = originalUserprofile;
  if (originalKill === undefined) delete process.env['SKILL_MAP_TELEMETRY'];
  else process.env['SKILL_MAP_TELEMETRY'] = originalKill;
  rmSync(homeRoot, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(join(homeRoot, '.skill-map'), { recursive: true, force: true });
  process.env['SKILL_MAP_TELEMETRY'] = '0';
});

describe('sm intentional-fail refuses to crash when a hard gate is closed', () => {
  it('exits 2 with the kill-switch refusal, without triggering the error', async () => {
    const cap = captureContext();
    const exit = await buildCli().run(['intentional-fail'], cap.context);
    assert.equal(exit, ExitCode.Error);
    assert.match(cap.stderr(), /SKILL_MAP_TELEMETRY=0/, cap.stderr());
    assert.doesNotMatch(
      cap.stderr(),
      /Triggering an intentional uncaught error/,
      'the crash must not be announced when nothing could be sent',
    );
  });

  it('does not mention consent: missing opt-in is not a refusal reason anymore', async () => {
    const cap = captureContext();
    await buildCli().run(['intentional-fail'], cap.context);
    assert.doesNotMatch(cap.stderr(), /telemetry\.errorsEnabled/, cap.stderr());
  });

  it('keeps stdout clean and terminates every stderr line', async () => {
    const cap = captureContext();
    await buildCli().run(['intentional-fail'], cap.context);
    assert.equal(cap.stdout(), '');
    assert.ok(cap.stderr().endsWith('\n'), JSON.stringify(cap.stderr()));
  });
});
