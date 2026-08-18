/**
 * `sm activity install <provider> --shell` refusal gate
 * (cli-contract.md §Activity; spec/provider-activity.md §Capture level
 * rung 5): the flag pair only means something on a provider whose
 * install descriptor carries the `optIn: 'shell'` event. For any other
 * provider the verb refuses BEFORE persisting anything, so
 * `activity.shellCapture` can never unlock the ladder's shell selector
 * with no capture wired behind it (and no uninstall path to retire it).
 */

import { describe, it, before, after } from 'node:test';
import { ok, strictEqual } from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { BaseContext } from 'clipanion';

import { ActivityInstallCommand } from '../activity.js';

let tmpRoot: string;
let counter = 0;
const originalCwd = process.cwd();

function freshFixture(label: string): string {
  counter += 1;
  return mkdtempSync(join(tmpRoot, `${label}-${counter}-`));
}

before(() => {
  const projectTmp = resolve(originalCwd, '.tmp');
  mkdirSync(projectTmp, { recursive: true });
  tmpRoot = mkdtempSync(join(projectTmp, 'activity-install-shell-gate-'));
});

after(() => {
  process.chdir(originalCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
});

interface ICapturedContext {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

/**
 * Construct the verb directly (no clipanion parse), so every declared
 * option must be assigned by hand (an untouched `Option.Boolean` holds
 * clipanion's TRUTHY descriptor object). `shell` deliberately stays
 * assignable per case: `undefined` is the no-flag state.
 */
function makeCmd(provider: string, shell: boolean | undefined): ActivityInstallCommand {
  const cmd = new ActivityInstallCommand();
  cmd.json = false;
  cmd.quiet = false;
  cmd.noColor = true;
  cmd.yes = true;
  cmd.provider = provider;
  cmd.shell = shell;
  return cmd;
}

describe('sm activity install --shell gate', () => {
  it('refuses --shell for a provider without the opt-in event, persisting nothing', async () => {
    const fixture = freshFixture('opencode-shell');
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd('opencode', true);
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 2);

    const err = cap.stderr();
    ok(err.includes('no shell capture rung'), 'refusal names the missing rung');
    ok(err.includes('claude') && err.includes('codex') && err.includes('antigravity'), 'refusal lists the shell-capable providers');
    // Nothing persisted, nothing installed: the gate fires first.
    strictEqual(existsSync(join(fixture, '.skill-map', 'settings.local.json')), false);
    strictEqual(existsSync(join(fixture, '.opencode', 'plugin', 'skill-map-activity.js')), false);
  });

  it('refuses --no-shell the same way (the pair belongs to the rung owners)', async () => {
    const fixture = freshFixture('opencode-no-shell');
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd('opencode', false);
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 2);
    strictEqual(existsSync(join(fixture, '.opencode', 'plugin', 'skill-map-activity.js')), false);
  });

  it('a bare install of the same provider still proceeds (the gate is flag-scoped)', async () => {
    const fixture = freshFixture('opencode-bare');
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd('opencode', undefined);
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);
    strictEqual(existsSync(join(fixture, '.opencode', 'plugin', 'skill-map-activity.js')), true);
  });

  it('codex accepts --shell now that its descriptor owns the rung (2026-08-18)', async () => {
    const fixture = freshFixture('codex-shell-accepted');
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd('codex', true);
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);
    // Key persisted AND the opt-in Bash matcher rendered.
    const local = JSON.parse(
      readFileSync(join(fixture, '.skill-map', 'settings.local.json'), 'utf8'),
    ) as { activity?: { shellCapture?: boolean } };
    strictEqual(local.activity?.shellCapture, true);
    ok(readFileSync(join(fixture, '.codex', 'hooks.json'), 'utf8').includes('^Bash$'));
  });
});
