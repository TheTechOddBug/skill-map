/**
 * `sm activity status [provider]` CLI verb tests (cli-contract.md
 * §Activity). Read-only report over the shared engine's
 * `activityInstallStatus`; the states are staged with the REAL engine
 * (install / hand-broken halves) against `.tmp/`-rooted fixture dirs.
 */

import { describe, it, before, after } from 'node:test';
import { ok, strictEqual } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { BaseContext } from 'clipanion';

import { builtIns } from '../../../plugins/built-ins.js';
import { installActivityBridge } from '../../../core/activity/install.js';
import { withSqlite } from '../../../core/sqlite/with-sqlite.js';
import { defaultProjectActivityDir, defaultProjectDbPath } from '../../util/db-path.js';
import { ActivityStatusCommand } from '../activity.js';

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
  tmpRoot = mkdtempSync(join(projectTmp, 'activity-status-cli-'));
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

function makeCmd(provider?: string): ActivityStatusCommand {
  const cmd = new ActivityStatusCommand();
  cmd.json = false;
  cmd.quiet = false;
  cmd.noColor = true;
  cmd.verbose = 0;
  cmd.provider = provider;
  return cmd;
}

function providerById(id: string) {
  const provider = builtIns().providers.find((p) => p.id === id);
  ok(provider, `built-in provider ${id} exists`);
  return provider!;
}

describe('sm activity status', () => {
  it('reports every activity-capable provider as not installed on a virgin project', async () => {
    const fixture = freshFixture('virgin');
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd();
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const out = cap.stdout();
    for (const id of ['claude', 'codex', 'antigravity', 'opencode']) {
      ok(out.includes(`${id}: not installed`), `${id} reported not installed`);
    }
  });

  it('reports installed after a real install (hook-file and plugin-file shapes)', async () => {
    const fixture = freshFixture('installed');
    await installActivityBridge(fixture, providerById('claude'));
    await installActivityBridge(fixture, providerById('opencode'));
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd();
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const out = cap.stdout();
    ok(out.includes('claude: installed (.claude/settings.json)'));
    ok(out.includes('opencode: installed (.opencode/plugin/skill-map-activity.js)'));
    ok(out.includes('codex: not installed'));
  });

  it('reports the partial state when the bridge artifact was hand-deleted', async () => {
    const fixture = freshFixture('partial');
    await installActivityBridge(fixture, providerById('claude'));
    rmSync(defaultProjectActivityDir(fixture), { recursive: true, force: true });
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd('claude');
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const out = cap.stdout();
    ok(out.includes('claude: partial'));
    ok(out.includes('bridge artifact is missing'));
    ok(out.includes('sm activity install claude'));
  });

  it('filters to the named provider only', async () => {
    const fixture = freshFixture('single');
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd('codex');
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const out = cap.stdout();
    ok(out.includes('codex: not installed'));
    ok(!out.includes('claude:'), 'other providers not listed');
  });

  it('exit 2 on an unknown provider, naming the available ones', async () => {
    const fixture = freshFixture('unknown');
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd('nope');
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 2);
    ok(cap.stderr().includes('claude'), 'hint lists available providers');
  });

  it('reports a TRUSTED drop-in provider that declares an activity adapter', async () => {
    // Gap: `sm activity` used to resolve providers off the built-in
    // registry only, so a drop-in provider's activity adapter was
    // invisible. The command now composes the full runtime (built-ins +
    // trusted drop-ins), so a project-local plugin the operator has
    // trusted is status-reportable like a built-in.
    const fixture = freshFixture('dropin-trusted');
    await writeExternalActivityPlugin(fixture, 'demo-live', true);
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd();
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    const out = cap.stdout();
    ok(out.includes('demo-live: not installed'), 'the trusted drop-in provider is listed');
    ok(out.includes('claude: not installed'), 'built-ins still listed alongside it');
  });

  it('does NOT report an UNTRUSTED drop-in provider (import gate closed)', async () => {
    // The import-trust boundary still applies: without a DB trust grant
    // the plugin code is never imported, so its activity adapter never
    // reaches the verb.
    const fixture = freshFixture('dropin-untrusted');
    await writeExternalActivityPlugin(fixture, 'demo-live', false);
    process.chdir(fixture);

    const cap = captureContext();
    const cmd = makeCmd();
    cmd.context = cap.context;
    strictEqual(await cmd.execute(), 0);

    ok(!cap.stdout().includes('demo-live'), 'an untrusted drop-in provider is NOT listed');
  });
});

/**
 * Lay down a minimal drop-in provider that declares a `plugin-file`
 * activity adapter under `<fixture>/.skill-map/plugins/<id>/`, optionally
 * writing a `config_plugins` DB trust row so `loadPluginRuntime` imports it.
 */
async function writeExternalActivityPlugin(
  fixture: string,
  id: string,
  trusted: boolean,
): Promise<void> {
  const pluginDir = join(fixture, '.skill-map', 'plugins', id);
  mkdirSync(join(pluginDir, 'providers', id), { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({ version: '0.1.0', specCompat: '*', catalogCompat: '*', description: 'drop-in activity provider' }),
  );
  writeFileSync(
    join(pluginDir, 'providers', id, 'index.js'),
    `export default {
       version: '0.1.0',
       description: 'drop-in provider with an activity adapter',
       presentation: { label: 'Demo Live', color: '#0891b2' },
       gatedByActiveLens: true,
       activity: {
         install: { kind: 'plugin-file', configPath: '.demo-live/plugin/activity.js' },
         pluginHooksSource: "  'tool.execute.before': async () => {},",
         mapEvent() { return null; },
       },
       classify() { return null; },
     };\n`,
  );
  if (trusted) {
    mkdirSync(join(fixture, '.skill-map'), { recursive: true });
    const dbPath = defaultProjectDbPath({ cwd: fixture });
    await withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      await adapter.trust.set(id, true);
    });
  }
}
