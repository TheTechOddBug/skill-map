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
  scan: { referencePaths: string[]; followExternalSymlinks: boolean; respectGitignore: boolean };
  tutorialReminderStep: number;
  ui: { liveUpdates: boolean; realtimeActivity: boolean };
  mcpServerEnabled: boolean;
  wakeOnSubmit: boolean;
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
    mcpServer: false,
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
        scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
        tutorialReminderStep: 0,
        ui: { liveUpdates: true, realtimeActivity: true },
        mcpServerEnabled: false,
        wakeOnSubmit: false,
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

  it('400 bad-query for the removed pluginTrust key (no longer in the contract)', async () => {
    // The blanket `pluginTrust.projectEnabled` opt-in was removed; the body
    // schema is `additionalProperties: false`, so the stale key is rejected
    // rather than silently honoured.
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pluginTrust: { projectEnabled: true } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.ok, false);
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

describe('PATCH /api/project-preferences (scan.respectGitignore policy)', () => {
  it('400 bad-query when scan.respectGitignore is not a boolean', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { respectGitignore: 'nope' } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /respectGitignore/);
    });
  });

  it('writes the committed policy to settings.json (NOT settings.local.json), no confirm needed', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { respectGitignore: true } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.scan.respectGitignore, true);

      // Team-shared policy: lands in the committed `settings.json`, not
      // the per-machine `settings.local.json` (unlike the other scan.* keys).
      const committed = JSON.parse(
        readFileSync(join(cwd, '.skill-map/settings.json'), 'utf8'),
      );
      assert.equal(committed.scan.respectGitignore, true);
    });
  });

  it('GET reflects the persisted policy', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.scan.respectGitignore, true);
    });
  });
});

describe('PATCH /api/project-preferences (mcpServerEnabled)', () => {
  it('400 bad-query when mcpServerEnabled is not a boolean', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mcpServerEnabled: 'nope' }),
      });
      assert.equal(res.status, 400);
    });
  });

  it('writes the enable to the project-local settings.local.json (per-operator), no confirm', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mcpServerEnabled: true }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.mcpServerEnabled, true);
      const local = JSON.parse(readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'));
      assert.equal(local.mcp.server.enabled, true);
    });
  });

  it('GET reflects the persisted enable', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.mcpServerEnabled, true);
    });
  });
});

describe('PATCH /api/project-preferences (wakeOnSubmit, the agent doorbell)', () => {
  it('400 bad-query when wakeOnSubmit is not a boolean', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wakeOnSubmit: 'nope' }),
      });
      assert.equal(res.status, 400);
    });
  });

  it('writes the consent to the project-local layer and GET reflects it', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wakeOnSubmit: true }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.wakeOnSubmit, true);
      // Project-LOCAL by contract: token-spending consent never travels
      // via the committed settings.json.
      const local = JSON.parse(readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'));
      assert.equal(local.jobs.wakeOnSubmit, true);
      const get = await fetch(url(handle, '/api/project-preferences'));
      assert.equal(((await get.json()) as IProjectPrefsEnvelopeWire).wakeOnSubmit, true);
    });
  });
});

describe('PATCH /api/project-preferences (tutorialReminderStep)', () => {
  it('400 bad-query when tutorialReminderStep is not an integer 0-2', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tutorialReminderStep: 'nope' }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /tutorialReminderStep/);
    });
  });

  it('400 bad-query when tutorialReminderStep is out of range', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tutorialReminderStep: 3 }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /tutorialReminderStep/);
    });
  });

  it('persists the step advance to settings.local.json (project-local), no confirm needed', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tutorialReminderStep: 1 }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.tutorialReminderStep, 1);

      // Project-local only: lands in the gitignored settings.local.json,
      // never the committed settings.json.
      const local = JSON.parse(
        readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
      );
      assert.equal(local.tutorialReminderStep, 1);
    });
  });

  it('GET reflects the persisted step', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.tutorialReminderStep, 1);
    });
  });
});

describe('PATCH /api/project-preferences (scan.followExternalSymlinks)', () => {
  it('412 confirm-required when turning it ON without confirm', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { followExternalSymlinks: true } }),
      });
      assert.equal(res.status, 412);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.ok, false);
      assert.match(env.error.message, /followExternalSymlinks/);
    });
  });

  it('turns ON with confirm=true and persists to project-local', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true, scan: { followExternalSymlinks: true } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.scan.followExternalSymlinks, true);
      // Project-local only: lands in the gitignored settings.local.json.
      const local = JSON.parse(
        readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
      );
      assert.equal(local.scan.followExternalSymlinks, true);
    });
  });

  it('turning it OFF needs no confirm (narrowing the surface)', async () => {
    // Pre-condition: previous test left it ON.
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { followExternalSymlinks: false } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.scan.followExternalSymlinks, false);
    });
  });

  it('400 bad-query when followExternalSymlinks is not a boolean', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scan: { followExternalSymlinks: 'nope' } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });
});

describe('PATCH /api/project-preferences (ui.* live-channel preferences)', () => {
  it('persists ui.liveUpdates to settings.local.json (project-local), no confirm needed', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ui: { liveUpdates: false } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.ui.liveUpdates, false);
      // The sibling key is untouched by a partial patch.
      assert.equal(env.ui.realtimeActivity, true);

      const local = JSON.parse(
        readFileSync(join(cwd, '.skill-map/settings.local.json'), 'utf8'),
      );
      assert.equal(local.ui.liveUpdates, false);
    });
  });

  it('persists ui.realtimeActivity and GET reflects both keys', async () => {
    await boot(async (handle) => {
      // Two partial patches, one per key: the second must not clobber
      // the first (both accumulate in settings.local.json), and a plain
      // GET reflects the persisted state of both. Self-contained: does
      // not rely on what the previous test wrote to the shared cwd.
      const bodies = [{ ui: { liveUpdates: false } }, { ui: { realtimeActivity: false } }];
      for (const body of bodies) {
        const patch = await fetch(url(handle, '/api/project-preferences'), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        assert.equal(patch.status, 200);
      }

      const res = await fetch(url(handle, '/api/project-preferences'));
      const env = (await res.json()) as IProjectPrefsEnvelopeWire;
      assert.equal(env.ui.liveUpdates, false);
      assert.equal(env.ui.realtimeActivity, false);
    });
  });

  it('400 bad-query when a ui sub-key is not a boolean', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ui: { liveUpdates: 'nope' } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /ui\.liveUpdates/);
    });
  });

  it('400 bad-query when the ui block has an unknown sub-key', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-preferences'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ui: { theme: 'dark' } }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });
});
