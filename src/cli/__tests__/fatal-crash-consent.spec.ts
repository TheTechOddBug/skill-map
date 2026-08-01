/**
 * Spawn-based guard for the process-fatal side of the per-incident
 * crash-report flow, driven through the hidden `sm intentional-fail`
 * self-test verb against the BUILT bundle (`bin/sm.js` → `dist/cli.js`,
 * same as every other spawn spec; rebuild before running locally).
 *
 * A piped child is non-TTY by construction, so these runs exercise the
 * non-promptable fallback: with no consent recorded the crash renders and
 * nothing is sent (silent), preserving Node's exit 1; under the kill switch
 * the verb refuses before crashing (exit 2). The opt-in auto-send path is
 * deliberately NOT spawned (it would hit the real DSN); it is covered by the
 * fake-loader unit suites. TTY prompting needs a pty and is covered by the
 * flow spec's fake streams.
 *
 * HOME/USERPROFILE are redirected to a tempdir so the developer's real
 * `~/.skill-map/settings.json` (and a possible real opt-in) can never leak
 * into a spawned run (see the CLI spawn-spec HOME-isolation rule).
 */

import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', '..', 'bin', 'sm.js');

let root: string;

interface IScope {
  cwd: string;
  home: string;
}

let counter = 0;

function freshScope(label: string): IScope {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  const cwd = join(dir, 'cwd');
  const home = join(dir, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { cwd, home };
}

function sm(
  args: string[],
  scope: IScope,
  extraEnv: Record<string, string> = {},
): { status: number; stdout: string; stderr: string } {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: scope.home,
    USERPROFILE: scope.home,
    NO_COLOR: '1',
    SM_NO_UPDATE_CHECK: '1',
    ...extraEnv,
  };
  // The test scripts pin SKILL_MAP_TELEMETRY=0 in the parent env; drop it
  // unless a case sets it explicitly, the whole point here is exercising
  // the non-kill-switch paths.
  if (!('SKILL_MAP_TELEMETRY' in extraEnv)) delete env['SKILL_MAP_TELEMETRY'];
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: scope.cwd,
    env: env as NodeJS.ProcessEnv,
    timeout: 30_000,
  });
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-fatal-crash-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('sm intentional-fail through the fatal crash handlers (spawned, non-TTY)', () => {
  it('no consent recorded: renders the stack, sends nothing, exits 1', () => {
    const scope = freshScope('silent');
    const r = sm(['intentional-fail'], scope);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /Triggering an intentional uncaught error/);
    assert.match(r.stderr, /skill-map intentional failure \(Sentry self-test\)/);
    // Non-promptable + no opt-in → silent fallback: no question, ever.
    assert.doesNotMatch(r.stderr, /Send this report\?/);
    assert.equal(r.stdout, '');
  });

  it('explicit opt-out behaves the same as no consent (exit 1, no question)', () => {
    const scope = freshScope('opt-out');
    mkdirSync(join(scope.home, '.skill-map'), { recursive: true });
    writeFileSync(
      join(scope.home, '.skill-map', 'settings.json'),
      JSON.stringify({ schemaVersion: 1, telemetry: { errorsEnabled: false } }),
    );
    const r = sm(['intentional-fail'], scope);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /skill-map intentional failure/);
    assert.doesNotMatch(r.stderr, /Send this report\?/);
  });

  it('kill switch: the verb refuses BEFORE crashing, exit 2', () => {
    const scope = freshScope('kill-switch');
    const r = sm(['intentional-fail'], scope, { SKILL_MAP_TELEMETRY: '0' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /SKILL_MAP_TELEMETRY=0/);
    assert.doesNotMatch(r.stderr, /skill-map intentional failure/);
  });

  /**
   * Regression (reported live 2026-08-01): the consent prompt died ~5s in,
   * looking like an instant auto-No. `intentional-fail`'s bounded fallback
   * timer resolved its `run()` promise mid-prompt, the normal entry tail
   * reached `process.exit(exitCode)`, and the process was killed with the
   * question still on screen. The tail now defers to the fatal handler
   * (`isHandlingFatalCrash`), so an answer given AFTER the fallback window
   * must still be honoured and acknowledged.
   *
   * Needs a real pty on both stdin and stderr (the prompt gate requires
   * TTYs), allocated through util-linux `script`; skipped off-Linux. `CI`
   * is dropped from the child env because the gate treats CI as
   * non-promptable.
   */
  it(
    'pty: the prompt survives the 5s fallback timer and honours a late answer',
    { skip: process.platform !== 'linux' },
    async () => {
      const scope = freshScope('pty-race');
      const env: Record<string, string | undefined> = {
        ...process.env,
        HOME: scope.home,
        USERPROFILE: scope.home,
        NO_COLOR: '1',
        SM_NO_UPDATE_CHECK: '1',
      };
      delete env['SKILL_MAP_TELEMETRY'];
      delete env['CI'];
      const child = spawn(
        'script',
        ['-qec', `${process.execPath} ${BIN} intentional-fail`, '/dev/null'],
        { cwd: scope.cwd, env: env as NodeJS.ProcessEnv },
      );
      let out = '';
      child.stdout.on('data', (c: Buffer) => {
        out += c.toString();
      });
      // Answer well AFTER the 5s fallback would have fired; before the fix
      // the process was already dead by now and the ack never printed.
      await new Promise((r) => setTimeout(r, 6_500));
      child.stdin.write('n\n');
      const code = await new Promise<number>((r) => {
        child.on('close', (c) => r(c ?? -1));
      });
      assert.match(out, /Send this report\?/, out);
      assert.match(out, /Not sent\./, out);
      assert.equal(code, 1, out);
    },
  );
});
