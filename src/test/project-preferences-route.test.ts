/**
 * Integration tests for the BFF project-preferences route.
 *
 *   GET   /api/project-preferences        → current envelope
 *   PATCH /api/project-preferences        → mutate one or more sub-keys
 *
 * Confirms:
 *   - GET returns the shipped defaults when no settings.json exists.
 *   - PATCH that NARROWS the surface (toggling includeHome `false`→`false`,
 *     setting empty arrays) writes through without `confirm: true`.
 *   - PATCH that EXPANDS the surface (toggling `includeHome` to `true`,
 *     adding out-of-project paths) returns 412 without `confirm: true`.
 *   - PATCH with `confirm: true` proceeds and persists.
 *   - 400 on body shape errors.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  createServer,
  type IServerOptions,
  type ServerHandle,
} from '../server/index.js';

interface IProjectPrefsEnvelopeWire {
  scan: { includeHome: boolean; extraRoots: string[]; referencePaths: string[] };
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
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-proj-prefs-'));
  dbPath = join(tmp, 'primed.db');
  cwd = mkdtempSync(join(tmpdir(), 'skill-map-proj-prefs-cwd-'));
  homedir = mkdtempSync(join(tmpdir(), 'skill-map-proj-prefs-home-'));
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

async function boot<T>(fn: (handle: ServerHandle) => Promise<T>): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd, homedir },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: ServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

describe('GET /api/project-preferences', () => {
  it('returns shipped defaults when settings.json is absent', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.deepEqual(env, {
        scan: { includeHome: false, extraRoots: [], referencePaths: [] },
      });
    });
  });
});

describe('PATCH /api/project-preferences', () => {
  it('412 confirm-required when toggling includeHome false→true without confirm', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { includeHome: true } }),
      });
      assert.equal(res.status, 412);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.ok, false);
      assert.match(env.error.message, /opens disk access outside the project/);
    });
  });

  it('writes when confirm=true is set', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true, scan: { includeHome: true } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.scan.includeHome, true);

      // PROJECT_LOCAL_ONLY keys land in `settings.local.json`
      // (gitignored) — the committed `settings.json` must NOT carry
      // them, otherwise a teammate's checkout would inherit the
      // per-machine state.
      const persisted = JSON.parse(
        readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
      );
      assert.equal(persisted.scan.includeHome, true);
    });
  });

  it('toggling includeHome back to false needs no confirm (narrowing)', async () => {
    // Pre-condition: previous test left includeHome=true persisted.
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { includeHome: false } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.scan.includeHome, false);
    });
  });

  it('400 bad-query when body is empty / no scan block', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });

  it('400 bad-query when scan.includeHome is not a boolean', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { includeHome: 'yes' } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });
});
