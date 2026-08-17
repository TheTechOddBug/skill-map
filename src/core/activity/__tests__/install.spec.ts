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
import { writeConfigValue } from '../../config/helper.js';
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
import { ACTIVITY_PLUGIN_MARKER, renderActivityPlugin } from '../plugin-template.js';

const CONFIG_REL = '.claude/settings.json';

/** Minimal provider stub carrying only what the engine reads. */
function makeProvider(id = 'claude', configPath = CONFIG_REL): IProvider {
  return {
    id,
    kind: 'provider',
    activity: {
      install: {
        kind: 'json-hooks',
        configPath,
        events: [
          { event: 'PreToolUse', matcher: '^(Skill|Agent|Read)$' },
          { event: 'SubagentStart', matcher: '*' },
        ],
      },
      mapEvent: () => null,
    },
  } as unknown as IProvider;
}

/** Hook-registration half a plugin-file provider would supply. */
const STUB_HOOKS_SOURCE = `    'my.hook': async (input) => {
      await forward('my.hook', { input });
    },`;

function readConfig(cwd: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(cwd, CONFIG_REL), 'utf8')) as Record<string, unknown>;
}

/** Every hook command string in a hook document, wherever it is nested. */
function hookCommandsOf(config: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'command' && typeof value === 'string') out.push(value);
      else walk(value);
    }
  };
  walk(config);
  return out;
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

  it('anchors the bridge path on the runtime project-dir variable when declared', async () => {
    // Regression, live-reported: the command used to be written
    // cwd-relative (`node .skill-map/activity/bridge.js claude`) on the
    // premise that hooks are spawned at the project root. That holds when
    // a session starts and NOT for its lifetime, because an agent that
    // changes directory while working takes the hook cwd with it. The
    // operator then gets a `MODULE_NOT_FOUND` naming a path they never
    // wrote, and ingestion stops silently.
    //
    // The variable form is absolute at spawn time yet writes no
    // machine-specific path, which matters because these hook configs
    // are routinely committed: a baked `/home/<someone>/...` would break
    // every teammate. That is why it beats both alternatives rather than
    // merely being tidier.
    const withVar = makeProvider();
    (withVar.activity!.install as { projectDirEnvVar?: string }).projectDirEnvVar = 'DEMO_ROOT';
    await installActivityBridge(cwd, withVar);

    const commands = hookCommandsOf(readConfig(cwd));
    assert.ok(commands.length > 0, 'the install must wire at least one command');
    for (const command of commands) {
      assert.equal(command, `node "$DEMO_ROOT"/${ACTIVITY_BRIDGE_REL} claude`);
      // Quote the variable only: the expansion may contain spaces, and
      // the bare relative substring has to survive for the ownership
      // marker uninstall keys on.
      assert.ok(command.includes(ACTIVITY_BRIDGE_REL), 'ownership marker substring must survive');
    }
  });

  it('falls back to the cwd-relative path for a runtime exposing no variable', async () => {
    // Not every runtime offers one, and guessing a name would be worse
    // than the relative form: an unset `$VAR` expands to empty, so the
    // path would resolve at the filesystem ROOT and the hook would break
    // always instead of only from a subdirectory.
    await installActivityBridge(cwd, makeProvider());
    for (const command of hookCommandsOf(readConfig(cwd))) {
      assert.equal(command, `node ${ACTIVITY_BRIDGE_REL} claude`);
    }
  });

  it('an opt-in event renders only while its key is on; re-install after key-off removes it', async () => {
    const gated = makeProvider();
    (gated.activity!.install as { events: unknown[] }).events = [
      { event: 'PreToolUse', matcher: '^(Skill|Agent|Read)$' },
      { event: 'PreToolUse', matcher: '^Bash$', optIn: 'shell' },
    ];

    // Key off (default): the opt-in event does not render.
    await installActivityBridge(cwd, gated);
    let hooks = readConfig(cwd)['hooks'] as Record<string, unknown[]>;
    assert.equal(JSON.stringify(hooks['PreToolUse']).includes('^Bash$'), false);

    // Key on (via the real write path, which mints the local-key grant):
    // a re-install renders it; a further BARE re-install preserves it.
    writeConfigValue('activity.shellCapture', true, { cwd, target: 'project-local' });
    await installActivityBridge(cwd, gated);
    hooks = readConfig(cwd)['hooks'] as Record<string, unknown[]>;
    assert.equal(JSON.stringify(hooks['PreToolUse']).includes('^Bash$'), true);
    await installActivityBridge(cwd, gated);
    hooks = readConfig(cwd)['hooks'] as Record<string, unknown[]>;
    assert.equal(JSON.stringify(hooks['PreToolUse']).includes('^Bash$'), true);

    // Key off again: remove-then-merge drops the event on re-install.
    writeConfigValue('activity.shellCapture', false, { cwd, target: 'project-local' });
    await installActivityBridge(cwd, gated);
    hooks = readConfig(cwd)['hooks'] as Record<string, unknown[]>;
    assert.equal(JSON.stringify(hooks['PreToolUse']).includes('^Bash$'), false);
    assert.equal(JSON.stringify(hooks['PreToolUse']).includes(ACTIVITY_BRIDGE_REL), true);
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

    const result = uninstallActivityBridge(cwd, provider, [provider]);

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

    assert.equal(uninstallActivityBridge(cwd, grouped, [grouped]).removed, true);
    const after = JSON.parse(
      readFileSync(join(cwd, '.agents/hooks.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal('skill-map-activity' in after, false);
    assert.equal(activityInstallStatus(cwd, grouped).installed, false);
  });

  it('plugin-file descriptor: install writes the plugin, uninstall deletes exactly it', async () => {
    const pluginProvider = {
      id: 'opencode',
      kind: 'provider',
      activity: {
        install: {
          kind: 'plugin-file',
          configPath: '.opencode/plugin/skill-map-activity.js',
        },
        mapEvent: () => null,
        pluginHooksSource: STUB_HOOKS_SOURCE,
      },
    } as unknown as IProvider;
    rmSync(join(cwd, '.opencode'), { recursive: true, force: true });

    assert.equal(activityInstallStatus(cwd, pluginProvider).installed, false);

    await installActivityBridge(cwd, pluginProvider);
    const pluginPath = join(cwd, '.opencode/plugin/skill-map-activity.js');
    const source = readFileSync(pluginPath, 'utf8');
    assert.equal(source.includes('skill-map activity plugin'), true);
    assert.equal(source.includes("PROVIDER = 'opencode'"), true);
    // The provider's hook registrations are spliced into the envelope.
    assert.equal(source.includes("await forward('my.hook', { input });"), true);
    // No spawned-bridge artifacts for this shape.
    assert.equal(existsSync(defaultProjectActivityDir(cwd)), false);
    // ESM-pinning sibling package.json so the vendor loads the `export`
    // plugin cleanly regardless of the host project's module type.
    const pkgPath = join(cwd, '.opencode/plugin/package.json');
    assert.equal(readFileSync(pkgPath, 'utf8'), '{\n  "type": "module"\n}\n');
    assert.deepEqual(activityInstallStatus(cwd, pluginProvider), {
      configWired: true,
      bridgePresent: true,
      installed: true,
    });

    assert.equal(uninstallActivityBridge(cwd, pluginProvider, [pluginProvider]).removed, true);
    assert.equal(existsSync(pluginPath), false);
    // Our package.json is removed too (exact reversal).
    assert.equal(existsSync(pkgPath), false);
    assert.equal(uninstallActivityBridge(cwd, pluginProvider, [pluginProvider]).removed, false);

    // A FOREIGN file at the same path is never ours: not installed,
    // and uninstall refuses to delete it.
    mkdirSync(join(cwd, '.opencode/plugin'), { recursive: true });
    writeFileSync(pluginPath, 'export const UserPlugin = async () => ({});\n', 'utf8');
    assert.equal(activityInstallStatus(cwd, pluginProvider).installed, false);
    assert.equal(uninstallActivityBridge(cwd, pluginProvider, [pluginProvider]).removed, false);
    assert.equal(existsSync(pluginPath), true);
  });

  it('plugin-file: a vendor-authored package.json is never clobbered on install nor removed on uninstall', async () => {
    const pluginProvider = {
      id: 'opencode',
      kind: 'provider',
      activity: {
        install: { kind: 'plugin-file', configPath: '.opencode/plugin/skill-map-activity.js' },
        mapEvent: () => null,
        pluginHooksSource: STUB_HOOKS_SOURCE,
      },
    } as unknown as IProvider;
    const pluginDir = join(cwd, '.opencode/plugin');
    const pkgPath = join(pluginDir, 'package.json');
    rmSync(join(cwd, '.opencode'), { recursive: true, force: true });

    // A pre-existing (vendor-owned) package.json in the shared plugin dir.
    mkdirSync(pluginDir, { recursive: true });
    const vendorPkg = '{ "type": "commonjs", "name": "vendor" }\n';
    writeFileSync(pkgPath, vendorPkg, 'utf8');

    await installActivityBridge(cwd, pluginProvider);
    assert.equal(readFileSync(pkgPath, 'utf8'), vendorPkg, 'install must not clobber a vendor package.json');

    assert.equal(uninstallActivityBridge(cwd, pluginProvider, [pluginProvider]).removed, true);
    assert.equal(readFileSync(pkgPath, 'utf8'), vendorPkg, 'uninstall must not remove a vendor package.json');
  });

  it('plugin-file install without pluginHooksSource refuses instead of writing a broken plugin', async () => {
    const sourceless = {
      id: 'opencode',
      kind: 'provider',
      activity: {
        install: {
          kind: 'plugin-file',
          configPath: '.opencode/plugin/skill-map-activity.js',
        },
        mapEvent: () => null,
      },
    } as unknown as IProvider;
    rmSync(join(cwd, '.opencode'), { recursive: true, force: true });

    await assert.rejects(installActivityBridge(cwd, sourceless), /pluginHooksSource/);
    assert.equal(existsSync(join(cwd, '.opencode/plugin/skill-map-activity.js')), false);
  });

  it('double uninstall is an idempotent no-op that touches nothing', async () => {
    await installActivityBridge(cwd, provider);
    assert.equal(uninstallActivityBridge(cwd, provider, [provider]).removed, true);

    const before = readFileSync(join(cwd, CONFIG_REL), 'utf8');
    assert.equal(uninstallActivityBridge(cwd, provider, [provider]).removed, false);
    assert.equal(readFileSync(join(cwd, CONFIG_REL), 'utf8'), before);
  });

  it('shared bridge survives until the LAST wired json-hooks provider uninstalls', async () => {
    const codex = makeProvider('codex', '.codex/hooks.json');
    const registry = [provider, codex];
    rmSync(join(cwd, '.codex'), { recursive: true, force: true });
    await installActivityBridge(cwd, provider);
    await installActivityBridge(cwd, codex);

    // First uninstall: claude's wiring goes, but codex still spawns the
    // shared bridge, so the dir MUST stay (deleting it would break
    // codex's hooks with a non-zero node exit).
    assert.equal(uninstallActivityBridge(cwd, provider, registry).removed, true);
    assert.equal(activityInstallStatus(cwd, provider).configWired, false);
    assert.equal(existsSync(defaultActivityBridgePath(cwd)), true);
    assert.equal(activityInstallStatus(cwd, codex).installed, true);

    // Last uninstall: nothing references the bridge anymore, dir goes.
    assert.equal(uninstallActivityBridge(cwd, codex, registry).removed, true);
    assert.equal(existsSync(defaultProjectActivityDir(cwd)), false);
  });

  it('a wired plugin-file provider never pins the shared bridge dir', async () => {
    const pluginProvider = {
      id: 'opencode',
      kind: 'provider',
      activity: {
        install: { kind: 'plugin-file', configPath: '.opencode/plugin/skill-map-activity.js' },
        mapEvent: () => null,
        pluginHooksSource: STUB_HOOKS_SOURCE,
      },
    } as unknown as IProvider;
    rmSync(join(cwd, '.opencode'), { recursive: true, force: true });
    await installActivityBridge(cwd, provider);
    await installActivityBridge(cwd, pluginProvider);

    // The in-process plugin does not reference `.skill-map/activity/`,
    // so the last json-hooks uninstall removes the dir even while the
    // plugin-file provider stays installed.
    assert.equal(
      uninstallActivityBridge(cwd, provider, [provider, pluginProvider]).removed,
      true,
    );
    assert.equal(existsSync(defaultProjectActivityDir(cwd)), false);
    assert.equal(activityInstallStatus(cwd, pluginProvider).installed, true);
  });
});

describe('renderActivityPlugin envelope', () => {
  // The provider-owned half (which hooks, which filters) is asserted in
  // each plugin-file provider's own spec against its pluginHooksSource;
  // here only the SHARED envelope contract is load-bearing.
  it('wraps the provider hooks with marker, provider id, and discovery invariants', () => {
    const source = renderActivityPlugin('opencode', STUB_HOOKS_SOURCE);
    assert.ok(source.includes(ACTIVITY_PLUGIN_MARKER));
    assert.ok(source.includes("PROVIDER = 'opencode'"));
    // Provider hooks land inside the returned registration map.
    assert.ok(source.includes("'my.hook': async (input) => {"));
    // Envelope invariants: serve.json discovery, loopback set, timeout.
    assert.ok(source.includes("join(root, '.skill-map', 'serve.json')"));
    assert.ok(source.includes('LOOPBACK_HOSTS'));
    assert.ok(source.includes('TIMEOUT_MS'));
    // Port sanity guard (audit L3): a tampered serve.json port must be
    // refused before it is interpolated into the request URL.
    assert.ok(source.includes('Number.isInteger(info.port)'));
    // No unfilled placeholders survive rendering.
    assert.equal(source.includes('{{'), false);
  });
});
