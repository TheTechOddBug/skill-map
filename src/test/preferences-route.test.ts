/**
 * Integration tests for the BFF preferences route.
 *
 *   GET   /api/preferences        → returns the user-scope envelope
 *   PATCH /api/preferences        → mutates one or more sub-keys
 *
 * Boots a real `createServer()` against a tempdir cwd / homedir so the
 * `~/.skill-map/settings.json` write goes to a sandboxed location.
 * Confirms:
 *   - GET returns `{ updateCheck: { enabled: true } }` by default.
 *   - PATCH writes through to the user-layer settings.json (NOT the
 *     project layer, the helper's `USER_ONLY_KEYS` guard.)
 *   - PATCH then GET round-trips the new value.
 *   - Empty body, malformed shape, and wrong type yield 400 with a
 *     directed `bad-query` envelope.
 *
 * The route's behavior under a populated `<cwd>/.skill-map/settings.json`
 * (project-layer override that should be ignored at read time) is
 * covered by `config-helper.test.ts`; this file is the wire-shape
 * smoke that exercises the full Hono pipeline end-to-end.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../server/index.js';

interface IPreferencesEnvelopeWire {
  updateCheck: { enabled: boolean };
}

interface IErrorEnvelopeWire {
  ok: false;
  error: { code: string; message: string };
}

let tmp: string;
let dbPath: string;
let cwd: string;
let homedir: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-prefs-route-'));
  dbPath = join(tmp, 'primed.db');
  cwd = mkdtempSync(join(tmpdir(), 'skill-map-prefs-cwd-'));
  homedir = mkdtempSync(join(tmpdir(), 'skill-map-prefs-home-'));
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  rmSync(homedir, { recursive: true, force: true });
});

function defaultOptions(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    scope: 'project',
    dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
  };
}

async function boot<T>(
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd, homedir },
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

describe('GET /api/preferences', () => {
  it('returns the default envelope when no settings.json exists', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IPreferencesEnvelopeWire;
      assert.deepEqual(env, { updateCheck: { enabled: true } });
    });
  });
});

describe('PATCH /api/preferences', () => {
  it('persists updateCheck.enabled=false to ~/.skill-map/settings.json', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updateCheck: { enabled: false } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IPreferencesEnvelopeWire;
      assert.deepEqual(env, { updateCheck: { enabled: false } });

      // Sanity: the file landed under HOME, not under CWD.
      const userPath = join(homedir, '.skill-map/settings.json');
      assert.ok(existsSync(userPath), 'user settings.json should exist');
      const persisted = JSON.parse(readFileSync(userPath, 'utf8'));
      assert.deepEqual(persisted, { updateCheck: { enabled: false } });
      assert.ok(
        !existsSync(join(cwd, '.skill-map/settings.json')),
        'project settings.json must NOT have been written',
      );

      // Re-read via GET, round-trips the new value.
      const re = await fetch(url(handle, '/api/preferences'));
      assert.equal(re.status, 200);
      const reEnv = (await re.json()) as IPreferencesEnvelopeWire;
      assert.deepEqual(reEnv, { updateCheck: { enabled: false } });
    });
  });

  it('400 bad-query when body is not JSON', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.ok, false);
      assert.equal(env.error.code, 'bad-query');
    });
  });

  it('400 bad-query when body is an empty object (no recognised key)', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /at least one known preference/);
    });
  });

  it('400 bad-query when updateCheck.enabled is not a boolean', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updateCheck: { enabled: 'yes' } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /enabled.*boolean/i);
    });
  });

  it('400 bad-query when body has an unknown top-level key (additionalProperties strict)', async () => {
    // Pre-AJV the manual parser silently ignored unknown keys, so a
    // typoed key (`updatecheck`, `update_check`) returned 400 only via
    // the `bodyEmpty` branch. Now AJV rejects the unknown key directly
    // with `additionalProperties:false`, surfacing a more accurate
    // signal for client bugs.
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updatecheck: { enabled: true } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });

  it('400 bad-query when updateCheck has an unknown sub-key', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updateCheck: { enabled: true, locale: 'en' } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });
});
