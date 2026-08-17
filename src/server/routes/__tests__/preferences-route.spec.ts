/**
 * Integration tests for the BFF preferences route.
 *
 *   GET   /api/preferences        → returns the update-check envelope
 *   PATCH /api/preferences        → mutates one or more sub-keys
 *
 * Post the no-`$HOME`-reads cleanup, the route persists through the
 * documented exception (`~/.skill-map/settings.json`, the only
 * legitimate `$HOME` reader, see `cli/util/user-settings-store.ts`).
 * Tests redirect HOME via `process.env.HOME` to a tempdir so the
 * write is sandboxed.
 *
 * Confirms:
 *   - GET returns the default envelope (update-check ON, telemetry OFF).
 *   - PATCH writes update-check / telemetry through to the file under HOME.
 *   - PATCH then GET round-trips the new value.
 *   - Empty body, malformed shape, and wrong type yield 400 with a
 *     directed `bad-query` envelope.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

interface IPreferencesEnvelopeWire {
  updateCheck: { enabled: boolean };
  githubStars: { enabled: boolean };
  telemetry: {
    errorsEnabled: boolean;
    usageCliEnabled: boolean;
    usageUiEnabled: boolean;
    anonymousId: string | null;
    environment: string;
  };
}

/**
 * The telemetry sub-envelope when nothing is opted in (every default).
 * `environment` is `prod` because the before-hook unsets
 * `SKILL_MAP_TELEMETRY_ENV` for deterministic assertions.
 */
const TELEMETRY_DEFAULT = {
  errorsEnabled: false,
  usageCliEnabled: false,
  usageUiEnabled: false,
  anonymousId: null,
  environment: 'prod',
} as const;

interface IErrorEnvelopeWire {
  ok: false;
  error: { code: string; message: string };
}

let tmp: string;
let dbPath: string;
let cwd: string;
let homedir: string;
let originalHome: string | undefined;
let originalEnv: string | undefined;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-prefs-route-'));
  dbPath = join(tmp, 'primed.db');
  cwd = mkdtempSync(join(tmpdir(), 'skill-map-prefs-cwd-'));
  homedir = mkdtempSync(join(tmpdir(), 'skill-map-prefs-home-'));
  // Redirect HOME so `os.homedir()` (read by the user-settings store)
  // resolves under our sandbox. The store is the documented exception
  // to the no-`$HOME`-reads principle; tests pin HOME instead of
  // threading a context override.
  originalHome = process.env['HOME'];
  process.env['HOME'] = homedir;
  // Unset the environment marker so the exposed `environment` is
  // deterministically `production` regardless of the dev's shell.
  originalEnv = process.env['SKILL_MAP_TELEMETRY_ENV'];
  delete process.env['SKILL_MAP_TELEMETRY_ENV'];
});

after(() => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  if (originalEnv === undefined) delete process.env['SKILL_MAP_TELEMETRY_ENV'];
  else process.env['SKILL_MAP_TELEMETRY_ENV'] = originalEnv;
  rmSync(tmp, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  rmSync(homedir, { recursive: true, force: true });
});

// Reset `~/.skill-map/` between tests so each starts from the shipped
// defaults; the settings file is shared across tests via the pinned HOME.
beforeEach(() => {
  rmSync(join(homedir, '.skill-map'), { recursive: true, force: true });
});

afterEach(() => {
  rmSync(join(homedir, '.skill-map'), { recursive: true, force: true });
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
    mcpServer: false,
    settingsEnv: {},
  };
}

async function boot<T>(
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
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

describe('GET /api/preferences', () => {
  it('returns the default envelope when no settings.json exists', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IPreferencesEnvelopeWire;
      assert.deepEqual(env, {
        updateCheck: { enabled: true },
        githubStars: { enabled: true },
        ui: { dismissedNotes: [] },
        telemetry: { ...TELEMETRY_DEFAULT },
      });
    });
  });
});

describe('PATCH /api/preferences', () => {
  it('persists dismissed UI notes machine-wide (whole-list replace, deduped)', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ui: { dismissedNotes: ['sessions-recording-intro', 'sessions-recording-intro'] },
        }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as { ui: { dismissedNotes: string[] } };
      assert.deepEqual(env.ui.dismissedNotes, ['sessions-recording-intro']);

      const persisted = JSON.parse(
        readFileSync(join(homedir, '.skill-map/settings.json'), 'utf8'),
      ) as { ui?: { dismissedNotes?: string[] } };
      assert.deepEqual(persisted.ui?.dismissedNotes, ['sessions-recording-intro']);
    });
  });

  it('persists updateCheck.enabled=false to ~/.skill-map/settings.json', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updateCheck: { enabled: false } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IPreferencesEnvelopeWire;
      assert.deepEqual(env, {
        updateCheck: { enabled: false },
        githubStars: { enabled: true },
        ui: { dismissedNotes: [] },
        telemetry: { ...TELEMETRY_DEFAULT },
      });

      // Sanity: the file landed under HOME (the documented exception),
      // not under CWD. The store writes to ~/.skill-map/settings.json
      // (per `cli/util/user-settings-store.ts`).
      const filePath = join(homedir, '.skill-map/settings.json');
      assert.ok(existsSync(filePath), 'settings.json should exist under HOME');
      const persisted = JSON.parse(readFileSync(filePath, 'utf8'));
      assert.equal(persisted.schemaVersion, 1);
      assert.equal(persisted.updateCheck.enabled, false);
      assert.ok(
        !existsSync(join(cwd, '.skill-map/settings.json')),
        'project settings.json must NOT have been written',
      );

      // Re-read via GET, round-trips the new value.
      const re = await fetch(url(handle, '/api/preferences'));
      assert.equal(re.status, 200);
      const reEnv = (await re.json()) as IPreferencesEnvelopeWire;
      assert.deepEqual(reEnv, {
        updateCheck: { enabled: false },
        githubStars: { enabled: true },
        ui: { dismissedNotes: [] },
        telemetry: { ...TELEMETRY_DEFAULT },
      });
    });
  });

  it('persists githubStars.enabled=false and round-trips it', async () => {
    // Regression: the store's merge enumerated its sub-objects by hand,
    // so this key was dropped between the PATCH and the file. The route
    // answered 200 with the OLD value and the toggle sprang back, which
    // is invisible from any test that only checks the status code.
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ githubStars: { enabled: false } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IPreferencesEnvelopeWire;
      assert.equal(env.githubStars.enabled, false);
      // Untouched neighbours keep their defaults.
      assert.equal(env.updateCheck.enabled, true);

      const persisted = JSON.parse(
        readFileSync(join(homedir, '.skill-map/settings.json'), 'utf8'),
      );
      assert.equal(persisted.githubStars.enabled, false);

      const re = await fetch(url(handle, '/api/preferences'));
      const reEnv = (await re.json()) as IPreferencesEnvelopeWire;
      assert.equal(reEnv.githubStars.enabled, false);
    });
  });

  it('persists telemetry.errorsEnabled=true to ~/.skill-map/settings.json', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ telemetry: { errorsEnabled: true } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IPreferencesEnvelopeWire;
      assert.equal(env.telemetry.errorsEnabled, true);
      // A telemetry-only patch leaves the update-check default untouched.
      assert.equal(env.updateCheck.enabled, true);

      const filePath = join(homedir, '.skill-map/settings.json');
      const persisted = JSON.parse(readFileSync(filePath, 'utf8'));
      assert.equal(persisted.telemetry.errorsEnabled, true);

      const re = await fetch(url(handle, '/api/preferences'));
      const reEnv = (await re.json()) as IPreferencesEnvelopeWire;
      assert.equal(reEnv.telemetry.errorsEnabled, true);
    });
  });

  it('enabling usageCliEnabled mints an anonymousId and exposes it read-only', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ telemetry: { usageCliEnabled: true } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IPreferencesEnvelopeWire;
      assert.equal(env.telemetry.usageCliEnabled, true);
      assert.equal(env.telemetry.usageUiEnabled, false, 'the UI toggle is independent');
      // The shared anonymous distinct_id is minted on first usage opt-in.
      assert.equal(typeof env.telemetry.anonymousId, 'string');
      assert.ok((env.telemetry.anonymousId ?? '').length > 0);

      // Enabling UI usage too must NOT rotate the already-minted id.
      const res2 = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ telemetry: { usageUiEnabled: true } }),
      });
      const env2 = (await res2.json()) as IPreferencesEnvelopeWire;
      assert.equal(env2.telemetry.anonymousId, env.telemetry.anonymousId);
      assert.equal(env2.telemetry.usageUiEnabled, true);
    });
  });

  it('400 bad-query when the patch tries to write anonymousId (read-only)', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ telemetry: { anonymousId: 'forged-id' } }),
      });
      // `additionalProperties: false` on the telemetry patch shape rejects it.
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });

  it('400 bad-query when telemetry.usageUiEnabled is not a boolean', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ telemetry: { usageUiEnabled: 'yes' } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /usageUiEnabled.*boolean/i);
    });
  });

  it('400 bad-query when telemetry.errorsEnabled is not a boolean', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ telemetry: { errorsEnabled: 'yes' } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /errorsEnabled.*boolean/i);
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
