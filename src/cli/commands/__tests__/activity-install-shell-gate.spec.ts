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
  // Every built-in activity provider owns the rung since 2026-08-18
  // (opencode joined via the plugin-file dialect), so the refusal path
  // is pinned at the engine level with synthetic providers
  // (`core/activity/__tests__/install.spec.ts`, providerOwnsShellOptIn);
  // this spec keeps the CLI-observable accept behaviour per dialect.

  it('a bare opencode install proceeds with the bash filter rendered CLOSED', async () => {
    const fixture = freshFixture('opencode-bare');
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd('opencode', undefined);
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);
    const plugin = readFileSync(
      join(fixture, '.opencode', 'plugin', 'skill-map-activity.js'),
      'utf8',
    );
    ok(plugin.includes("input.tool === 'bash' && !false"), 'filter rendered closed');
  });

  it('opencode accepts --shell: key persisted, plugin re-rendered with the filter OPEN', async () => {
    const fixture = freshFixture('opencode-shell-accepted');
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd('opencode', true);
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);
    const local = JSON.parse(
      readFileSync(join(fixture, '.skill-map', 'settings.local.json'), 'utf8'),
    ) as { activity?: { shellCapture?: boolean } };
    strictEqual(local.activity?.shellCapture, true);
    const plugin = readFileSync(
      join(fixture, '.opencode', 'plugin', 'skill-map-activity.js'),
      'utf8',
    );
    ok(plugin.includes("input.tool === 'bash' && !true"), 'filter rendered open');
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
