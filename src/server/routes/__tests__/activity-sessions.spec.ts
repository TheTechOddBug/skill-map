/**
 * `GET` + `DELETE /api/activity/sessions` (spec/provider-activity.md
 * §Session journal · Read-back / Deletion), driven through a REAL
 * `createServer()` boot against a temp scope: the GET serves the
 * on-disk recordings with off-shape basenames honesty-listed in
 * `skipped`; the DELETE empties the directory, answers 204 always, and
 * logs one `activity.sessions-clear` operations line.
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { removeConfigValue, writeConfigValue } from '../../../core/config/helper.js';
import { defaultProjectSessionsDir } from '../../../core/paths/db-path.js';
import { createServer, type IServerHandle } from '../../index.js';
import type { IServerOptions } from '../../options.js';

let scopeRoot: string;

function defaultOptions(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: join(scopeRoot, '.skill-map', 'skill-map.db'),
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

async function bootAndUse<T>(fn: (handle: IServerHandle) => Promise<T>): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd: scopeRoot },
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

const VALID_RECORDING = {
  schemaVersion: 1,
  sessionId: 's1',
  rootOwner: 'main:s1',
  provider: 'claude',
  startedAt: 1_723_800_000_000,
  endedAt: 1_723_800_600_000,
  frames: [
    {
      tMs: 1_723_800_000_100,
      type: 'node.activity',
      data: { nodePath: 'README.md', phase: 'start', owner: 'main:s1' },
    },
  ],
};

before(() => {
  scopeRoot = mkdtempSync(join(tmpdir(), 'skill-map-activity-sessions-'));
  mkdirSync(join(scopeRoot, '.skill-map'), { recursive: true });
});

after(() => {
  rmSync(scopeRoot, { recursive: true, force: true });
});

describe('POST /api/activity/sessions/recording', () => {
  it('toggles the capture state, and the GET envelope mirrors it for reloads', async () => {
    await bootAndUse(async (handle) => {
      const before = (await (await fetch(url(handle, '/api/activity/sessions'))).json()) as {
        recording: boolean;
      };
      assert.equal(before.recording, false); // boot state: off, never ambient

      const on = await fetch(url(handle, '/api/activity/sessions/recording'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recording: true }),
      });
      assert.equal(on.status, 200);
      assert.deepEqual(await on.json(), { recording: true });

      const mid = (await (await fetch(url(handle, '/api/activity/sessions'))).json()) as {
        recording: boolean;
      };
      assert.equal(mid.recording, true);

      const off = await fetch(url(handle, '/api/activity/sessions/recording'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recording: false }),
      });
      assert.deepEqual(await off.json(), { recording: false });

      const bad = await fetch(url(handle, '/api/activity/sessions/recording'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recording: 'yes' }),
      });
      assert.equal(bad.status, 400);
    });
  });

  it('retention config keys thread to the boot prune (maxFiles trims the journal at startup)', async () => {
    const dir = defaultProjectSessionsDir(scopeRoot);
    mkdirSync(dir, { recursive: true });
    for (const suffix of ['a1', 'b2', 'c3']) {
      writeFileSync(
        join(dir, `2026-08-17T0${suffix[1]}0000.000Z-${suffix}.json`),
        JSON.stringify({ ...VALID_RECORDING, sessionId: suffix, rootOwner: `main:${suffix}` }),
      );
    }
    const settingsPath = join(scopeRoot, '.skill-map', 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ activity: { journal: { maxFiles: 1 } } }));
    try {
      await bootAndUse(async (handle) => {
        const body = (await (await fetch(url(handle, '/api/activity/sessions'))).json()) as {
          sessions: Array<{ sessionId?: string }>;
        };
        // Boot prune, oldest first: only the newest recording survives.
        assert.equal(body.sessions.length, 1);
        assert.equal(body.sessions[0]!.sessionId, 'c3');
      });
    } finally {
      rmSync(settingsPath, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the byte ceiling prunes too, and an off-shape maxFiles falls back to the default', async () => {
    const dir = defaultProjectSessionsDir(scopeRoot);
    mkdirSync(dir, { recursive: true });
    // ~40 KB per file: three files far exceed a 90 KB ceiling, while
    // any two fit under it.
    const fat = {
      ...VALID_RECORDING,
      frames: [
        {
          tMs: 1_723_800_000_100,
          type: 'node.activity',
          data: { nodePath: 'README.md', phase: 'start', owner: 'main:s1', detail: 'x'.repeat(40_000) },
        },
      ],
    };
    for (const suffix of ['a1', 'b2', 'c3']) {
      writeFileSync(
        join(dir, `2026-08-17T0${suffix[1]}0000.000Z-${suffix}.json`),
        JSON.stringify({ ...fat, sessionId: suffix, rootOwner: `main:${suffix}` }),
      );
    }
    const settingsPath = join(scopeRoot, '.skill-map', 'settings.json');
    // maxFiles 0 is OFF-SHAPE (schema minimum 1): the boot must fall
    // back to the default ceiling instead of wiping the journal, so
    // only the byte bound below does any pruning.
    writeFileSync(
      settingsPath,
      JSON.stringify({ activity: { journal: { maxFiles: 0, maxTotalBytes: 90_000 } } }),
    );
    try {
      await bootAndUse(async (handle) => {
        const body = (await (await fetch(url(handle, '/api/activity/sessions'))).json()) as {
          sessions: Array<{ sessionId?: string }>;
        };
        assert.deepEqual(
          body.sessions.map((s) => s.sessionId),
          ['b2', 'c3'], // oldest evicted by bytes; the rest kept (name order)
        );
      });
    } finally {
      rmSync(settingsPath, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the capture level hydrates at default, moves live, and persists project-local', async () => {
    await bootAndUse(async (handle) => {
      const before = (await (await fetch(url(handle, '/api/activity/sessions'))).json()) as {
        captureLevel: string;
      };
      assert.equal(before.captureLevel, 'mcp'); // the historical full surface

      const moved = await fetch(url(handle, '/api/activity/capture-level'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'reads' }),
      });
      assert.equal(moved.status, 200);
      assert.deepEqual(await moved.json(), { captureLevel: 'reads' });

      const after = (await (await fetch(url(handle, '/api/activity/sessions'))).json()) as {
        captureLevel: string;
      };
      assert.equal(after.captureLevel, 'reads');

      // Persisted to the project-LOCAL layer (an operational knob,
      // never the committed settings.json).
      const local = JSON.parse(
        readFileSync(join(scopeRoot, '.skill-map', 'settings.local.json'), 'utf8'),
      ) as { activity?: { captureLevel?: string } };
      assert.equal(local.activity?.captureLevel, 'reads');

      // Off-ladder values are a 400, not a silent default.
      const bad = await fetch(url(handle, '/api/activity/capture-level'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'everything' }),
      });
      assert.equal(bad.status, 400);
    });
    rmSync(join(scopeRoot, '.skill-map', 'settings.local.json'), { force: true });
  });

  it('the capture level LOCKS while recording: the POST answers the unchanged level', async () => {
    await bootAndUse(async (handle) => {
      await fetch(url(handle, '/api/activity/sessions/recording'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recording: true }),
      });
      const refused = await fetch(url(handle, '/api/activity/capture-level'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'executions' }),
      });
      assert.deepEqual(await refused.json(), { captureLevel: 'mcp' }); // unchanged

      await fetch(url(handle, '/api/activity/sessions/recording'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recording: false }),
      });
      const moved = await fetch(url(handle, '/api/activity/capture-level'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'executions' }),
      });
      assert.deepEqual(await moved.json(), { captureLevel: 'executions' });
    });
    rmSync(join(scopeRoot, '.skill-map', 'settings.local.json'), { force: true });
  });

  it('rung 5 needs the install opt-in: shell refused without the key, accepted with it', async () => {
    // Without `activity.shellCapture` the POST answers the unchanged
    // level (same refusal dialect as the recording lock) and the GET
    // envelope reports the opt-in as off.
    await bootAndUse(async (handle) => {
      const refused = await fetch(url(handle, '/api/activity/capture-level'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'shell' }),
      });
      assert.deepEqual(await refused.json(), { captureLevel: 'mcp' }); // unchanged

      const envelope = (await (await fetch(url(handle, '/api/activity/sessions'))).json()) as {
        shellCapture: boolean;
      };
      assert.equal(envelope.shellCapture, false);
    });

    // Flip the opt-in through the real write path (the install flag /
    // BFF install route both go through `writeConfigValue`, which mints
    // the per-checkout grant a hand-written settings.local.json lacks).
    writeConfigValue('activity.shellCapture', true, { cwd: scopeRoot, target: 'project-local' });
    try {
      await bootAndUse(async (handle) => {
        const envelope = (await (await fetch(url(handle, '/api/activity/sessions'))).json()) as {
          shellCapture: boolean;
        };
        assert.equal(envelope.shellCapture, true);

        const moved = await fetch(url(handle, '/api/activity/capture-level'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ level: 'shell' }),
        });
        assert.deepEqual(await moved.json(), { captureLevel: 'shell' });
      });
    } finally {
      removeConfigValue('activity.shellCapture', { cwd: scopeRoot, target: 'project-local' });
      rmSync(join(scopeRoot, '.skill-map', 'settings.local.json'), { force: true });
    }
  });

  it('the live level SELF-HEALS to the default when the opt-in is retired mid-serve', async () => {
    writeConfigValue('activity.shellCapture', true, { cwd: scopeRoot, target: 'project-local' });
    try {
      await bootAndUse(async (handle) => {
        const moved = await fetch(url(handle, '/api/activity/capture-level'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ level: 'shell' }),
        });
        assert.deepEqual(await moved.json(), { captureLevel: 'shell' });

        // Retirement lands from elsewhere (uninstall / --no-shell in
        // another terminal): the next journal read demotes the live
        // cell instead of reporting a rung the opt-in no longer backs.
        removeConfigValue('activity.shellCapture', { cwd: scopeRoot, target: 'project-local' });
        const envelope = (await (await fetch(url(handle, '/api/activity/sessions'))).json()) as {
          captureLevel: string;
          shellCapture: boolean;
        };
        assert.equal(envelope.shellCapture, false);
        assert.equal(envelope.captureLevel, 'mcp');

        // And the demotion persisted for the next boot.
        const local = JSON.parse(
          readFileSync(join(scopeRoot, '.skill-map', 'settings.local.json'), 'utf8'),
        ) as { activity?: { captureLevel?: string } };
        assert.equal(local.activity?.captureLevel, 'mcp');
      });
    } finally {
      removeConfigValue('activity.shellCapture', { cwd: scopeRoot, target: 'project-local' });
      rmSync(join(scopeRoot, '.skill-map', 'settings.local.json'), { force: true });
    }
  });

  it('the master switch off refuses to engage: the response answers with the EFFECTIVE state', async () => {
    // Boot with `activity.journal.enabled: false` in the project layer;
    // the toggle must answer honestly instead of pretending to record.
    const settingsPath = join(scopeRoot, '.skill-map', 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ activity: { journal: { enabled: false } } }));
    try {
      await bootAndUse(async (handle) => {
        const res = await fetch(url(handle, '/api/activity/sessions/recording'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ recording: true }),
        });
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { recording: false });

        const envelope = (await (await fetch(url(handle, '/api/activity/sessions'))).json()) as {
          recording: boolean;
        };
        assert.equal(envelope.recording, false);
      });
    } finally {
      rmSync(settingsPath, { force: true });
    }
  });
});

describe('GET + DELETE /api/activity/sessions', () => {
  it('serves valid recordings and honesty-lists the off-shape files, then the DELETE wipes both', async () => {
    const dir = defaultProjectSessionsDir(scopeRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2026-08-16T100000.000Z-s1.json'), JSON.stringify(VALID_RECORDING));
    writeFileSync(join(dir, '2026-08-16T110000.000Z-bad.json'), '{ not json');

    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/activity/sessions'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        schemaVersion: string;
        kind: string;
        sessions: Array<{ rootOwner: string; frames: unknown[] }>;
        skipped: string[];
      };
      assert.equal(body.kind, 'activity-sessions');
      assert.equal(body.sessions.length, 1);
      assert.equal(body.sessions[0]?.rootOwner, 'main:s1');
      assert.equal(body.sessions[0]?.frames.length, 1);
      assert.deepEqual(body.skipped, ['2026-08-16T110000.000Z-bad.json']);

      const del = await fetch(url(handle, '/api/activity/sessions'), { method: 'DELETE' });
      assert.equal(del.status, 204);
      const after1 = await fetch(url(handle, '/api/activity/sessions'));
      const emptied = (await after1.json()) as { sessions: unknown[]; skipped: unknown[] };
      assert.equal(emptied.sessions.length, 0);
      // The off-shape file is machine junk too: the wipe took it as well.
      assert.equal(emptied.skipped.length, 0);

      const log = readFileSync(join(scopeRoot, '.skill-map', 'operations.log'), 'utf8');
      const clears = log
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line['op'] === 'activity.sessions-clear');
      assert.equal(clears.length, 1);
      assert.equal(clears[0]?.['detail'], 'deleted=2');
    });
  });
});
