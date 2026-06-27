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
} from '../../index.js';

interface IProjectPrefsEnvelopeWire {
  allowSidecarWriters: boolean;
  scan: { referencePaths: string[] };
  pluginTrust: { projectEnabled: boolean };
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
    runtimeContext: { cwd },
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
        allowSidecarWriters: true,
        scan: { referencePaths: [] },
        pluginTrust: { projectEnabled: false },
      });
    });
  });
});

describe('PATCH /api/project-preferences', () => {
  it('412 confirm-required when adding an out-of-project path without confirm', async () => {
    await boot(async (handle) => {
      // `homedir` is a real tmp dir created in `before()`. It must
      // exist on disk because the route's existence gate runs BEFORE
      // the privacy gate (a typo'd path returns 400 before the user
      // ever sees the confirm dialog).
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { referencePaths: [homedir] } }),
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
          scan: { referencePaths: [homedir] },
        }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.deepEqual(env.scan.referencePaths, [homedir]);

      // PROJECT_LOCAL_ONLY keys land in `settings.local.json`
      // (gitignored), the committed `settings.json` must NOT carry
      // them, otherwise a teammate's checkout would inherit the
      // per-machine state.
      const persisted = JSON.parse(
        readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
      );
      assert.deepEqual(persisted.scan.referencePaths, [homedir]);
    });
  });

  it('removing a reference path needs no confirm (narrowing)', async () => {
    // Pre-condition: previous test left referencePaths=[homedir].
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { referencePaths: [] } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.deepEqual(env.scan.referencePaths, []);
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

  it('400 bad-query when referencePaths contains a non-string entry', async () => {
    // The schema validates `items: { type: 'string' }` so any item that
    // is not a string fails. The mapping resolves to the catalog
    // template with the offending key embedded.
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { referencePaths: ['ok', 42, 'also-ok'] } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /scan\.referencePaths/);
    });
  });

  it('400 bad-query when referencePaths is not an array', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { referencePaths: 'not-an-array' } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /scan\.referencePaths/);
    });
  });

  it('400 bad-query when scan block has an unknown sub-key (additionalProperties strict)', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { referencePaths: [], unknownKey: 1 } }),
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
        body: JSON.stringify({ scan: { referencePaths: [] }, somethingElse: true }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });
});

describe('PATCH /api/project-preferences (allowSidecarWriters policy)', () => {
  it('400 bad-query when allowSidecarWriters is not a boolean', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allowSidecarWriters: 'nope' }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /allowSidecarWriters/);
    });
  });

  it('writes the policy to the committed settings.json (NOT settings.local.json), no confirm needed', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allowSidecarWriters: false }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.allowSidecarWriters, false);

      // Team-shared policy: lands in the committed `settings.json`, not
      // the per-machine `settings.local.json`.
      const committed = JSON.parse(
        readFileSync(join(cwd, '.skill-map/settings.json'), 'utf8'),
      );
      assert.equal(committed.allowSidecarWriters, false);
    });
  });

  it('GET reflects the persisted policy', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.allowSidecarWriters, false);
    });
  });
});
