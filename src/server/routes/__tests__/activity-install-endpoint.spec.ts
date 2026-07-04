/**
 * `GET/POST /api/activity/install` + `POST /api/activity/uninstall`
 * integration tests (see `spec/provider-activity.md` §Install
 * management over HTTP).
 *
 * Each test boots a real `createServer()` (built-ins ON, so the real
 * `claude` provider with its activity descriptor is registered) against
 * a tempdir fixture cwd and fires `fetch()` at the endpoints, then
 * asserts BOTH the wire envelope and the on-disk effects (the provider
 * config, the bridge artifact). The load-bearing cases: the 412 consent
 * gate touches NOTHING, install preserves operator hooks, uninstall
 * reverses exactly and is idempotent.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

const CONFIG_REL = '.claude/settings.json';
const BRIDGE_REL = '.skill-map/activity/bridge.js';

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-activity-install-endpoint-'));
  root = {
    tmp,
    fixtureRoot: join(tmp, 'fixture'),
    dbPath: join(tmp, 'primed.db'),
  };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(root.fixtureRoot, { recursive: true, force: true });
  mkdirSync(root.fixtureRoot, { recursive: true });
});

function defaultOptions(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: root.dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
  };
}

async function bootAndUse<T>(fn: (handle: IServerHandle) => Promise<T>): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd: root.fixtureRoot },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

async function getStatus(handle: IServerHandle, provider: string): Promise<Response> {
  return fetch(url(handle, `/api/activity/install?provider=${provider}`));
}

async function post(handle: IServerHandle, path: string, body: unknown): Promise<Response> {
  return fetch(url(handle, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function readFixtureConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root.fixtureRoot, CONFIG_REL), 'utf8')) as Record<
    string,
    unknown
  >;
}

function seedOperatorHook(): void {
  mkdirSync(join(root.fixtureRoot, '.claude'), { recursive: true });
  writeFileSync(
    join(root.fixtureRoot, CONFIG_REL),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'my-linter' }] }],
      },
    }),
    'utf8',
  );
}

interface IStatusEnvelope {
  provider: string;
  supported: boolean;
  installed: boolean;
  configPath: string | null;
  configWired: boolean;
  bridgePresent: boolean;
  events: number;
  removed?: boolean;
}

describe('GET /api/activity/install, status probe', () => {
  it('404 not-found on an unknown provider id', async () => {
    await bootAndUse(async (handle) => {
      const res = await getStatus(handle, 'nope');
      assert.equal(res.status, 404);
      const envelope = (await res.json()) as { error: { code: string } };
      assert.equal(envelope.error.code, 'not-found');
    });
  });

  it('400 bad-query when the provider param is missing', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/activity/install'));
      assert.equal(res.status, 400);
    });
  });

  it('supported: false for a registered provider without activity', async () => {
    await bootAndUse(async (handle) => {
      const res = await getStatus(handle, 'markdown');
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.deepEqual(envelope, {
        provider: 'markdown',
        supported: false,
        installed: false,
        configPath: null,
        configWired: false,
        bridgePresent: false,
        events: 0,
      });
    });
  });

  it('claude pre-install: supported, not installed, descriptor surfaced', async () => {
    await bootAndUse(async (handle) => {
      const res = await getStatus(handle, 'claude');
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.supported, true);
      assert.equal(envelope.installed, false);
      assert.equal(envelope.configPath, CONFIG_REL);
      assert.equal(envelope.events, 5);
    });
  });

  it('codex: second provider with an adapter surfaces ITS descriptor', async () => {
    await bootAndUse(async (handle) => {
      const res = await getStatus(handle, 'codex');
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.supported, true);
      assert.equal(envelope.installed, false);
      assert.equal(envelope.configPath, '.codex/hooks.json');
      assert.equal(envelope.events, 3);
    });
  });

  it('opencode: plugin-file provider installs the in-process plugin over HTTP', async () => {
    await bootAndUse(async (handle) => {
      const status = (await (await getStatus(handle, 'opencode')).json()) as IStatusEnvelope;
      assert.equal(status.supported, true);
      assert.equal(status.configPath, '.opencode/plugin/skill-map-activity.js');
      assert.equal(status.installed, false);

      const res = await post(handle, '/api/activity/install', {
        provider: 'opencode',
        confirm: true,
      });
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.installed, true);
      const source = readFileSync(
        join(root.fixtureRoot, '.opencode/plugin/skill-map-activity.js'),
        'utf8',
      );
      assert.equal(source.includes('skill-map activity plugin'), true);

      const un = await post(handle, '/api/activity/uninstall', {
        provider: 'opencode',
        confirm: true,
      });
      assert.equal(un.status, 200);
      assert.equal(((await un.json()) as IStatusEnvelope).removed, true);
      assert.equal(
        existsSync(join(root.fixtureRoot, '.opencode/plugin/skill-map-activity.js')),
        false,
      );
    });
  });

  it('antigravity: named-group provider installs into its own group over HTTP', async () => {
    await bootAndUse(async (handle) => {
      const status = (await (await getStatus(handle, 'antigravity')).json()) as IStatusEnvelope;
      assert.equal(status.supported, true);
      assert.equal(status.configPath, '.agents/hooks.json');
      assert.equal(status.events, 2);

      const res = await post(handle, '/api/activity/install', {
        provider: 'antigravity',
        confirm: true,
      });
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.installed, true);

      const config = JSON.parse(
        readFileSync(join(root.fixtureRoot, '.agents/hooks.json'), 'utf8'),
      ) as Record<string, unknown>;
      assert.notEqual(config['skill-map-activity'], undefined);
      assert.equal('hooks' in config, false);
    });
  });
});

describe('POST /api/activity/install, consent gate + effects', () => {
  it('412 confirm-required without confirm, and NOTHING is written', async () => {
    await bootAndUse(async (handle) => {
      const res = await post(handle, '/api/activity/install', { provider: 'claude' });
      assert.equal(res.status, 412);
      const envelope = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(envelope.error.code, 'confirm-required');
      assert.equal(envelope.error.message.includes(CONFIG_REL), true);
      assert.equal(existsSync(join(root.fixtureRoot, CONFIG_REL)), false);
      assert.equal(existsSync(join(root.fixtureRoot, '.skill-map')), false);
    });
  });

  it('installs with confirm: true, preserving pre-existing operator hooks', async () => {
    seedOperatorHook();
    await bootAndUse(async (handle) => {
      const res = await post(handle, '/api/activity/install', {
        provider: 'claude',
        confirm: true,
      });
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.installed, true);
      assert.equal(envelope.configWired, true);
      assert.equal(envelope.bridgePresent, true);

      const config = readFixtureConfig();
      const hooks = config['hooks'] as Record<string, unknown[]>;
      assert.equal(JSON.stringify(hooks['PreToolUse']![0]).includes('my-linter'), true);
      assert.equal(JSON.stringify(hooks['PreToolUse']![1]).includes(BRIDGE_REL), true);
      assert.equal(existsSync(join(root.fixtureRoot, BRIDGE_REL)), true);

      const status = (await (await getStatus(handle, 'claude')).json()) as IStatusEnvelope;
      assert.equal(status.installed, true);
    });
  });

  it('reinstall refreshes the wiring idempotently', async () => {
    await bootAndUse(async (handle) => {
      await post(handle, '/api/activity/install', { provider: 'claude', confirm: true });
      const first = readFileSync(join(root.fixtureRoot, CONFIG_REL), 'utf8');
      const res = await post(handle, '/api/activity/install', {
        provider: 'claude',
        confirm: true,
      });
      assert.equal(res.status, 200);
      assert.equal(readFileSync(join(root.fixtureRoot, CONFIG_REL), 'utf8'), first);
    });
  });

  it('400 on a provider without an installable activity hook', async () => {
    await bootAndUse(async (handle) => {
      const res = await post(handle, '/api/activity/install', {
        provider: 'markdown',
        confirm: true,
      });
      assert.equal(res.status, 400);
    });
  });

  it('404 on an unknown provider; 400 on a body without provider', async () => {
    await bootAndUse(async (handle) => {
      assert.equal(
        (await post(handle, '/api/activity/install', { provider: 'nope', confirm: true })).status,
        404,
      );
      assert.equal((await post(handle, '/api/activity/install', {})).status, 400);
    });
  });
});

describe('POST /api/activity/uninstall, consent gate + exact reversal', () => {
  it('412 confirm-required without confirm, config untouched', async () => {
    await bootAndUse(async (handle) => {
      await post(handle, '/api/activity/install', { provider: 'claude', confirm: true });
      const before = readFileSync(join(root.fixtureRoot, CONFIG_REL), 'utf8');

      const res = await post(handle, '/api/activity/uninstall', { provider: 'claude' });
      assert.equal(res.status, 412);
      assert.equal(readFileSync(join(root.fixtureRoot, CONFIG_REL), 'utf8'), before);
      assert.equal(existsSync(join(root.fixtureRoot, BRIDGE_REL)), true);
    });
  });

  it('uninstalls with confirm: true, operator hooks kept, activity dir removed', async () => {
    seedOperatorHook();
    await bootAndUse(async (handle) => {
      await post(handle, '/api/activity/install', { provider: 'claude', confirm: true });

      const res = await post(handle, '/api/activity/uninstall', {
        provider: 'claude',
        confirm: true,
      });
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.removed, true);
      assert.equal(envelope.installed, false);

      const config = readFixtureConfig();
      const hooks = config['hooks'] as Record<string, unknown[]>;
      assert.equal(hooks['PreToolUse']!.length, 1);
      assert.equal(JSON.stringify(hooks['PreToolUse']![0]).includes('my-linter'), true);
      assert.equal(existsSync(join(root.fixtureRoot, '.skill-map/activity')), false);
    });
  });

  it('double uninstall is idempotent: removed: false', async () => {
    await bootAndUse(async (handle) => {
      await post(handle, '/api/activity/install', { provider: 'claude', confirm: true });
      await post(handle, '/api/activity/uninstall', { provider: 'claude', confirm: true });

      const res = await post(handle, '/api/activity/uninstall', {
        provider: 'claude',
        confirm: true,
      });
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.removed, false);
      assert.equal(envelope.installed, false);
    });
  });
});
