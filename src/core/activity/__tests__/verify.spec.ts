/**
 * Wiring self-test engine (`core/activity/verify.ts`, contract:
 * `spec/provider-activity.md` §Wiring self-test).
 *
 * The verdict matrix is exercised against real on-disk state (a tempdir
 * scope whose hook config and bridge artifact are written per case), with
 * the two EXECUTING legs injected: the bridge spawn and the readback
 * poll. That keeps the test hermetic while still proving the branch each
 * verdict comes from.
 *
 * The `bridge-failed` cases matter most: they encode the failure class
 * this whole surface exists for, a bridge that runs and reports nothing
 * (the module-type trap, a stale serve.json warning), which the
 * install-state report happily calls `installed`.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { IProvider } from '../../../kernel/extensions/index.js';
import { builtIns } from '../../../plugins/built-ins.js';
import { ACTIVITY_BRIDGE_REL } from '../../paths/db-path.js';
import { installActivityBridge } from '../install.js';
import { PROBE_MARKER } from '../probe.js';
import { isFailingVerdict, verifyActivityWiring, type IBridgeRun } from '../verify.js';

/** The real `plugin-file` provider, so its install is the real one. */
function opencodeBuiltIn(): IProvider {
  const provider = builtIns().providers.find((p) => p.id === 'opencode');
  if (provider === undefined) throw new Error('built-in provider opencode exists');
  return provider;
}

const CONFIG_PATH = '.claude/settings.json';

let scope: string;

beforeEach(() => {
  scope = mkdtempSync(join(tmpdir(), 'skill-map-verify-'));
});

afterEach(() => {
  rmSync(scope, { recursive: true, force: true });
});

/** Minimal `json-hooks` provider; only the fields the engine reads. */
function hookProvider(): IProvider {
  return {
    id: 'claude',
    version: '1.0.0',
    activity: {
      install: {
        kind: 'json-hooks',
        configPath: CONFIG_PATH,
        events: [{ event: 'PreToolUse', matcher: '*' }],
      },
      mapEvent: () => null,
    },
  } as unknown as IProvider;
}

function pluginFileProvider(): IProvider {
  return {
    id: 'opencode',
    version: '1.0.0',
    activity: {
      install: { kind: 'plugin-file', configPath: '.opencode/plugin/skill-map-activity.js' },
      mapEvent: () => null,
    },
  } as unknown as IProvider;
}

/** Write a hook config whose command references the installed bridge. */
function writeWiredConfig(): void {
  mkdirSync(join(scope, '.claude'), { recursive: true });
  writeFileSync(
    join(scope, CONFIG_PATH),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/${ACTIVITY_BRIDGE_REL}"` }],
          },
        ],
      },
    }),
    'utf8',
  );
}

function writeBridge(): void {
  mkdirSync(join(scope, '.skill-map', 'activity'), { recursive: true });
  writeFileSync(join(scope, ACTIVITY_BRIDGE_REL), '// bridge\n', 'utf8');
}

function writeServeInfo(): void {
  mkdirSync(join(scope, '.skill-map'), { recursive: true });
  writeFileSync(
    join(scope, '.skill-map', 'serve.json'),
    JSON.stringify({
      schemaVersion: 1,
      host: '127.0.0.1',
      port: 4242,
      pid: 1,
      scopeRoot: scope,
      startedAt: new Date().toISOString(),
      smVersion: '0.0.0',
      token: 'tok',
    }),
    'utf8',
  );
}

/** A fully installed + serving scope: the only shape worth probing. */
function writeHealthyScope(): void {
  writeWiredConfig();
  writeBridge();
  writeServeInfo();
}

const cleanRun: IBridgeRun = { code: 0, stderr: '' };

function runBridgeStub(run: IBridgeRun): () => Promise<IBridgeRun> {
  return () => Promise.resolve(run);
}

describe('verifyActivityWiring, disk-only verdicts', () => {
  it('reports `unsupported` for an INSTALLED in-process plugin provider', async () => {
    await installActivityBridge(scope, opencodeBuiltIn());
    const result = await verifyActivityWiring(scope, opencodeBuiltIn());
    assert.equal(result.verdict, 'unsupported');
    assert.match(result.detail ?? '', /nothing to spawn/);
    assert.equal(isFailingVerdict(result.verdict), false);
  });

  it('reports `not-installed` (not `unsupported`) for an absent plugin provider', async () => {
    // Install state is read BEFORE the install kind, so an uninstalled
    // provider reads the same way whatever its shape.
    const result = await verifyActivityWiring(scope, pluginFileProvider());
    assert.equal(result.verdict, 'not-installed');
  });

  it('reports `not-installed` when neither half is present', async () => {
    const result = await verifyActivityWiring(scope, hookProvider());
    assert.equal(result.verdict, 'not-installed');
    assert.equal(isFailingVerdict(result.verdict), false);
  });

  it('reports `incomplete` when the bridge artifact is missing', async () => {
    writeWiredConfig();
    const result = await verifyActivityWiring(scope, hookProvider());
    assert.equal(result.verdict, 'incomplete');
    assert.match(result.detail ?? '', /bridge artifact is missing/);
    assert.equal(isFailingVerdict(result.verdict), true);
  });

  it('reports `server-down` when serve.json is absent', async () => {
    writeWiredConfig();
    writeBridge();
    const result = await verifyActivityWiring(scope, hookProvider());
    assert.equal(result.verdict, 'server-down');
  });

  it('reports `server-down` when serve.json is malformed', async () => {
    writeWiredConfig();
    writeBridge();
    mkdirSync(join(scope, '.skill-map'), { recursive: true });
    writeFileSync(join(scope, '.skill-map', 'serve.json'), '{ not json', 'utf8');
    const result = await verifyActivityWiring(scope, hookProvider());
    assert.equal(result.verdict, 'server-down');
  });

  it('never spawns anything before the disk gates pass', async () => {
    let spawned = false;
    await verifyActivityWiring(scope, hookProvider(), {
      runBridge: () => {
        spawned = true;
        return Promise.resolve(cleanRun);
      },
    });
    assert.equal(spawned, false);
  });
});

describe('verifyActivityWiring, executing verdicts', () => {
  it('reports `ok` once the server confirms the nonce', async () => {
    writeHealthyScope();
    let handedPayload = '';
    const result = await verifyActivityWiring(scope, hookProvider(), {
      nonce: 'n-1',
      runBridge: (_bridge, _provider, payload) => {
        handedPayload = payload;
        return Promise.resolve(cleanRun);
      },
      readProbe: (_target, nonce) => Promise.resolve(nonce === 'n-1' ? 'seen' : 'unseen'),
    });
    assert.equal(result.verdict, 'ok');
    // The bridge is handed the probe payload verbatim on stdin.
    assert.deepEqual(JSON.parse(handedPayload), { [PROBE_MARKER]: 'n-1' });
  });

  it('spawns the bridge WE composed, never a path from the config', async () => {
    writeHealthyScope();
    let spawnedPath = '';
    await verifyActivityWiring(scope, hookProvider(), {
      runBridge: (bridge) => {
        spawnedPath = bridge;
        return Promise.resolve(cleanRun);
      },
      readProbe: () => Promise.resolve('seen'),
    });
    assert.equal(spawnedPath, join(scope, ACTIVITY_BRIDGE_REL));
  });

  it('reports `server-down` on a stale serve.json, without spawning the bridge', async () => {
    // The hard-kill case: serve.json survives the dead server. Without
    // the liveness pre-check this reads as `bridge-failed`, because the
    // bridge fails open on an unreachable server (warn + exit 0).
    writeHealthyScope();
    let spawned = false;
    const result = await verifyActivityWiring(scope, hookProvider(), {
      runBridge: () => {
        spawned = true;
        return Promise.resolve(cleanRun);
      },
      readProbe: () => Promise.resolve('unreachable'),
    });
    assert.equal(result.verdict, 'server-down');
    assert.match(result.detail ?? '', /127\.0\.0\.1:4242/);
    assert.equal(spawned, false);
  });

  it('reports `bridge-failed` on a non-zero exit', async () => {
    writeHealthyScope();
    const result = await verifyActivityWiring(scope, hookProvider(), {
      runBridge: runBridgeStub({ code: 1, stderr: '' }),
      readProbe: () => Promise.resolve('unseen'),
    });
    assert.equal(result.verdict, 'bridge-failed');
    assert.match(result.detail ?? '', /exited 1/);
  });

  it('reports `bridge-failed` when the bridge warns on stderr', async () => {
    writeHealthyScope();
    const result = await verifyActivityWiring(scope, hookProvider(), {
      runBridge: runBridgeStub({
        code: 0,
        stderr: 'skill-map activity bridge: server unreachable (stale serve.json?)\n',
      }),
      readProbe: () => Promise.resolve('unseen'),
    });
    assert.equal(result.verdict, 'bridge-failed');
    assert.match(result.detail ?? '', /server unreachable/);
  });

  it('reports `bridge-failed` when the process could not run at all', async () => {
    writeHealthyScope();
    const result = await verifyActivityWiring(scope, hookProvider(), {
      runBridge: runBridgeStub({ code: null, stderr: '', failure: 'could not spawn the bridge' }),
      readProbe: () => Promise.resolve('unseen'),
    });
    assert.equal(result.verdict, 'bridge-failed');
    assert.match(result.detail ?? '', /could not spawn/);
  });

  it('reports `not-received` when a clean run never reaches the server', async () => {
    writeHealthyScope();
    const result = await verifyActivityWiring(scope, hookProvider(), {
      runBridge: runBridgeStub(cleanRun),
      readProbe: () => Promise.resolve('unseen'),
      readbackTimeoutMs: 0,
    });
    assert.equal(result.verdict, 'not-received');
    assert.equal(isFailingVerdict(result.verdict), true);
  });
});
