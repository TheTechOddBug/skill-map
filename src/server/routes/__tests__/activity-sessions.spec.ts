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
