/**
 * Integration tests for the BFF project-preferences route.
 *
 *   GET   /api/project-preferences        → current envelope
 *   PATCH /api/project-preferences        → mutate one or more sub-keys
 *
 * Confirms:
 *   - GET returns the shipped defaults when no settings.json exists.
 *   - PATCH that NARROWS the surface (removing paths) writes through
 *     without `confirm: true`.
 *   - PATCH that EXPANDS the surface (adding out-of-project paths)
 *     returns 412 without `confirm: true`.
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
  type IServerHandle,
} from '../server/index.js';

interface IProjectPrefsEnvelopeWire {
  scan: { extraFolders: string[]; referencePaths: string[] };
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

async function boot<T>(fn: (handle: IServerHandle) => Promise<T>): Promise<T> {
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

describe('GET /api/project-preferences', () => {
  it('returns shipped defaults when settings.json is absent', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.deepEqual(env, {
        scan: { extraFolders: [], referencePaths: [] },
      });
    });
  });
});

describe('PATCH /api/project-preferences', () => {
  it('412 confirm-required when adding an out-of-project path without confirm', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { extraFolders: ['~/some-folder'] } }),
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
        body: JSON.stringify({
          confirm: true,
          scan: { extraFolders: ['~/some-folder'] },
        }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.deepEqual(env.scan.extraFolders, ['~/some-folder']);

      // PROJECT_LOCAL_ONLY keys land in `settings.local.json`
      // (gitignored) — the committed `settings.json` must NOT carry
      // them, otherwise a teammate's checkout would inherit the
      // per-machine state.
      const persisted = JSON.parse(
        readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
      );
      assert.deepEqual(persisted.scan.extraFolders, ['~/some-folder']);
    });
  });

  it('removing an extra folder needs no confirm (narrowing)', async () => {
    // Pre-condition: previous test left extraFolders=['~/some-folder'].
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { extraFolders: [] } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.deepEqual(env.scan.extraFolders, []);
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

  it('400 bad-query when extraFolders contains a non-string entry', async () => {
    // The schema validates `items: { type: 'string' }` so any item that
    // is not a string fails. The mapping resolves to the catalog
    // template with the offending key embedded.
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { extraFolders: ['ok', 42, 'also-ok'] } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /scan\.extraFolders/);
    });
  });

  it('400 bad-query when extraFolders is not an array', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { extraFolders: 'not-an-array' } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /scan\.extraFolders/);
    });
  });

  it('400 bad-query when scan block has an unknown sub-key (additionalProperties strict)', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { extraFolders: [], unknownKey: 1 } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });

  it('400 bad-query when body has an unknown top-level key', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { extraFolders: [] }, somethingElse: true }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });
});
