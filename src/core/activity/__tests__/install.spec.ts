/**
 * Shared activity install engine (`core/activity/install.ts`): the
 * sequences both the CLI verbs and the BFF install routes drive. The
 * load-bearing assertions: status derives from BOTH halves (config
 * marker + bridge file), install preserves operator hooks and repairs
 * half-installed states, uninstall reverses exactly and is idempotent.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { IProvider } from '../../../kernel/extensions/index.js';
import {
  ACTIVITY_BRIDGE_REL,
  defaultActivityBridgePath,
  defaultProjectActivityDir,
} from '../../paths/db-path.js';
import {
  activityInstallStatus,
  findActivityProvider,
  installActivityBridge,
  uninstallActivityBridge,
} from '../install.js';

const CONFIG_REL = '.claude/settings.json';

/** Minimal provider stub carrying only what the engine reads. */
function makeProvider(id = 'claude'): IProvider {
  return {
    id,
    kind: 'provider',
    activity: {
      install: {
        kind: 'json-hooks',
        configPath: CONFIG_REL,
        events: [
          { event: 'PreToolUse', matcher: '^(Skill|Agent|Read)$' },
          { event: 'SubagentStart', matcher: '*' },
        ],
      },
      mapEvent: () => null,
    },
  } as unknown as IProvider;
}

function readConfig(cwd: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(cwd, CONFIG_REL), 'utf8')) as Record<string, unknown>;
}

describe('core/activity install engine', () => {
  let cwd: string;
  const provider = makeProvider();

  before(() => {
    cwd = mkdtempSync(join(tmpdir(), 'skill-map-activity-install-'));
  });
  after(() => {
    rmSync(cwd, { recursive: true, force: true });
  });
  beforeEach(() => {
    rmSync(join(cwd, '.claude'), { recursive: true, force: true });
    rmSync(join(cwd, '.skill-map'), { recursive: true, force: true });
  });

  it('findActivityProvider matches only providers declaring activity', () => {
    const plain = { id: 'markdown', kind: 'provider' } as unknown as IProvider;
    assert.equal(findActivityProvider([plain, provider], 'claude'), provider);
    assert.equal(findActivityProvider([plain, provider], 'markdown'), null);
    assert.equal(findActivityProvider([plain, provider], 'nope'), null);
  });

  it('status on a virgin project: nothing wired, nothing present', () => {
    assert.deepEqual(activityInstallStatus(cwd, provider), {
      configWired: false,
      bridgePresent: false,
      installed: false,
    });
  });

  it('install writes all artifacts and preserves pre-existing operator hooks', async () => {
    mkdirSync(dirname(join(cwd, CONFIG_REL)), { recursive: true });
    writeFileSync(
      join(cwd, CONFIG_REL),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'my-linter' }] }],
        },
      }),
      'utf8',
    );

    await installActivityBridge(cwd, provider);

    const config = readConfig(cwd);
    const hooks = config['hooks'] as Record<string, unknown[]>;
    // Operator entry untouched, ours appended, second event created.
    assert.equal(JSON.stringify(hooks['PreToolUse']![0]).includes('my-linter'), true);
    assert.equal(JSON.stringify(hooks['PreToolUse']![1]).includes(ACTIVITY_BRIDGE_REL), true);
    assert.equal(hooks['SubagentStart']!.length, 1);
    assert.equal(existsSync(defaultActivityBridgePath(cwd)), true);
    assert.equal(
      readFileSync(join(defaultProjectActivityDir(cwd), 'package.json'), 'utf8').includes(
        '"type": "commonjs"',
      ),
      true,
    );
    assert.deepEqual(activityInstallStatus(cwd, provider), {
      configWired: true,
      bridgePresent: true,
      installed: true,
    });
  });

  it('reinstall refreshes a stale wiring in place (remove-then-merge)', async () => {
    await installActivityBridge(cwd, provider);
    // Simulate an OLDER install: rewrite our entry with a stale matcher.
    const config = readConfig(cwd);
    const hooks = config['hooks'] as Record<string, unknown[]>;
    hooks['PreToolUse'] = [
      { matcher: '^Skill$', hooks: [{ type: 'command', command: `node ${ACTIVITY_BRIDGE_REL} claude` }] },
    ];
    writeFileSync(join(cwd, CONFIG_REL), JSON.stringify(config), 'utf8');

    await installActivityBridge(cwd, provider);

    const refreshed = readConfig(cwd);
    const entries = (refreshed['hooks'] as Record<string, unknown[]>)['PreToolUse']!;
    assert.equal(entries.length, 1);
    assert.equal((entries[0] as { matcher?: string }).matcher, '^(Skill|Agent|Read)$');
  });

  it('install repairs a half-installed state (bridge hand-deleted)', async () => {
    await installActivityBridge(cwd, provider);
    rmSync(defaultProjectActivityDir(cwd), { recursive: true, force: true });
    assert.deepEqual(activityInstallStatus(cwd, provider), {
      configWired: true,
      bridgePresent: false,
      installed: false,
    });

    await installActivityBridge(cwd, provider);
    assert.equal(activityInstallStatus(cwd, provider).installed, true);
  });

  it('uninstall reverses exactly: marked entries out, operator hooks kept, dir removed', async () => {
    mkdirSync(dirname(join(cwd, CONFIG_REL)), { recursive: true });
    writeFileSync(
      join(cwd, CONFIG_REL),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'my-linter' }] }],
        },
      }),
      'utf8',
    );
    await installActivityBridge(cwd, provider);

    const result = uninstallActivityBridge(cwd, provider);

    assert.equal(result.removed, true);
    const config = readConfig(cwd);
    const hooks = config['hooks'] as Record<string, unknown[]>;
    assert.equal(hooks['PreToolUse']!.length, 1);
    assert.equal(JSON.stringify(hooks['PreToolUse']![0]).includes('my-linter'), true);
    assert.equal('SubagentStart' in hooks, false);
    assert.equal(existsSync(defaultProjectActivityDir(cwd)), false);
    assert.equal(activityInstallStatus(cwd, provider).installed, false);
  });

  it('named-group descriptor: install/status/uninstall operate on the owned group', async () => {
    const grouped = {
      id: 'antigravity',
      kind: 'provider',
      activity: {
        install: {
          kind: 'json-hooks',
          configPath: '.agents/hooks.json',
          group: 'skill-map-activity',
          commandCwd: 'config-dir',
          events: [{ event: 'PreToolUse', matcher: 'view_file' }],
        },
        mapEvent: () => null,
      },
    } as unknown as IProvider;

    await installActivityBridge(cwd, grouped);
    const config = JSON.parse(
      readFileSync(join(cwd, '.agents/hooks.json'), 'utf8'),
    ) as Record<string, unknown>;
    const group = config['skill-map-activity'] as Record<string, unknown[]>;
    assert.notEqual(group, undefined);
    assert.equal(JSON.stringify(group['PreToolUse']![0]).includes(ACTIVITY_BRIDGE_REL), true);
    // config-dir spawn cwd: the command hops from .agents/ back to root.
    assert.equal(
      JSON.stringify(group['PreToolUse']![0]).includes(`node ../${ACTIVITY_BRIDGE_REL} antigravity`),
      true,
    );
    assert.equal('hooks' in config, false);
    assert.equal(activityInstallStatus(cwd, grouped).installed, true);

    assert.equal(uninstallActivityBridge(cwd, grouped).removed, true);
    const after = JSON.parse(
      readFileSync(join(cwd, '.agents/hooks.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal('skill-map-activity' in after, false);
    assert.equal(activityInstallStatus(cwd, grouped).installed, false);
  });

  it('double uninstall is an idempotent no-op that touches nothing', async () => {
    await installActivityBridge(cwd, provider);
    assert.equal(uninstallActivityBridge(cwd, provider).removed, true);

    const before = readFileSync(join(cwd, CONFIG_REL), 'utf8');
    assert.equal(uninstallActivityBridge(cwd, provider).removed, false);
    assert.equal(readFileSync(join(cwd, CONFIG_REL), 'utf8'), before);
  });
});
