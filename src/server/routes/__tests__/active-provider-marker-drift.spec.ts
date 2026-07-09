/**
 * Integration tests for the BFF active-provider route's marker-drift
 * surface:
 *
 *   GET  /api/active-provider                → envelope now carries
 *     `markerDrift: { added, removed, detected } | null`.
 *   POST /api/active-provider/accept-markers → reconciles the persisted
 *     `activeProviderMarkers` snapshot with the detected set (the SPA
 *     "Dismiss" action) and returns the refreshed envelope
 *     (`markerDrift: null`).
 *
 * Confirms:
 *   - aligned snapshot → `markerDrift: null`.
 *   - a Provider directory that appeared since the snapshot → populated
 *     `markerDrift` naming the added id.
 *   - accept-markers clears the drift (200, `markerDrift: null`) AND
 *     persists the reconciled snapshot to settings.json, so a follow-up
 *     GET stays null.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

interface IMarkerDriftWire {
  added: string[];
  removed: string[];
  detected: string[];
}

interface IActiveProviderWire {
  activeProvider: string;
  detected: string[];
  source: 'config' | 'autodetect' | 'default';
  selectable: string[];
  markerDrift: IMarkerDriftWire | null;
}

let dbPath: string;

before(() => {
  // A path that never points at a real file: the fresh resolver then
  // degrades to the boot-cached resolver, which already read the cwd's
  // settings.json at server boot.
  dbPath = join(mkdtempSync(join(tmpdir(), 'skill-map-marker-drift-db-')), 'absent.db');
});

after(() => {
  rmSync(join(dbPath, '..'), { recursive: true, force: true });
});

/**
 * Create a project cwd with a settings.json (activeProvider +
 * activeProviderMarkers snapshot) and the given on-disk provider marker
 * directories, so `resolveActiveProvider` auto-detects them.
 */
function makeCwd(opts: {
  settings: Record<string, unknown>;
  markerDirs: readonly string[];
}): string {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-map-marker-drift-cwd-'));
  mkdirSync(join(cwd, '.skill-map'), { recursive: true });
  writeFileSync(
    join(cwd, '.skill-map', 'settings.json'),
    JSON.stringify({ schemaVersion: 1, ...opts.settings }, null, 2),
    'utf8',
  );
  for (const dir of opts.markerDirs) {
    mkdirSync(join(cwd, dir), { recursive: true });
  }
  return cwd;
}

function readMarkersSnapshot(cwd: string): unknown {
  const parsed = JSON.parse(
    readFileSync(join(cwd, '.skill-map', 'settings.json'), 'utf8'),
  ) as Record<string, unknown>;
  return parsed['activeProviderMarkers'];
}

function options(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: false,
    open: false,
    devCors: false,
    noWatcher: true,
    mcpServer: false,
  };
}

async function boot<T>(cwd: string, fn: (handle: IServerHandle) => Promise<T>): Promise<T> {
  const handle = await createServer(options(), { runtimeContext: { cwd } });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

describe('GET /api/active-provider markerDrift', () => {
  it('is null when the snapshot matches the detected set', async () => {
    const cwd = makeCwd({
      settings: { activeProvider: 'claude', activeProviderMarkers: ['claude'] },
      markerDirs: ['.claude'],
    });
    try {
      await boot(cwd, async (handle) => {
        const res = await fetch(url(handle, '/api/active-provider'));
        assert.equal(res.status, 200);
        const body = (await res.json()) as IActiveProviderWire;
        assert.equal(body.markerDrift, null);
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('is populated when a Provider directory appeared since the snapshot', async () => {
    const cwd = makeCwd({
      // Snapshot taken when only `.claude` existed; `.codex` appeared later.
      settings: { activeProvider: 'claude', activeProviderMarkers: ['claude'] },
      markerDirs: ['.claude', '.codex'],
    });
    try {
      await boot(cwd, async (handle) => {
        const res = await fetch(url(handle, '/api/active-provider'));
        assert.equal(res.status, 200);
        const body = (await res.json()) as IActiveProviderWire;
        assert.ok(body.markerDrift !== null, 'expected a non-null markerDrift');
        assert.deepEqual(body.markerDrift.added, ['codex']);
        assert.deepEqual(body.markerDrift.removed, []);
        assert.ok(body.markerDrift.detected.includes('claude'));
        assert.ok(body.markerDrift.detected.includes('codex'));
        // The lens itself is unchanged; the drift is informational.
        assert.equal(body.activeProvider, 'claude');
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('POST /api/active-provider/accept-markers', () => {
  it('reconciles the snapshot, clears the drift, and persists the detected set', async () => {
    const cwd = makeCwd({
      settings: { activeProvider: 'claude', activeProviderMarkers: ['claude'] },
      markerDirs: ['.claude', '.codex'],
    });
    try {
      await boot(cwd, async (handle) => {
        // Precondition: GET reports drift.
        const before = (await (
          await fetch(url(handle, '/api/active-provider'))
        ).json()) as IActiveProviderWire;
        assert.ok(before.markerDrift !== null, 'precondition: drift present');

        // Dismiss: accept the current markers.
        const res = await fetch(url(handle, '/api/active-provider/accept-markers'), {
          method: 'POST',
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as IActiveProviderWire;
        assert.equal(body.markerDrift, null, 'drift cleared in the response envelope');

        // The reconciled snapshot landed on disk (claude + codex).
        const snapshot = readMarkersSnapshot(cwd) as string[];
        assert.ok(Array.isArray(snapshot));
        assert.ok(snapshot.includes('claude'));
        assert.ok(snapshot.includes('codex'));

        // A follow-up GET stays null (self-healed).
        const after = (await (
          await fetch(url(handle, '/api/active-provider'))
        ).json()) as IActiveProviderWire;
        assert.equal(after.markerDrift, null);
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('PATCH /api/active-provider (switch lens)', () => {
  it('refreshes the markers snapshot so the drift clears when the lens changes', async () => {
    const cwd = makeCwd({
      // Snapshot taken when only `.claude` existed; `.codex` appeared later.
      settings: { activeProvider: 'claude', activeProviderMarkers: ['claude'] },
      markerDirs: ['.claude', '.codex'],
    });
    try {
      await boot(cwd, async (handle) => {
        // Precondition: GET reports drift (added codex).
        const before = (await (
          await fetch(url(handle, '/api/active-provider'))
        ).json()) as IActiveProviderWire;
        assert.ok(before.markerDrift !== null, 'precondition: drift present');

        // Switch the lens to the newly-detected provider.
        const res = await fetch(url(handle, '/api/active-provider'), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ activeProvider: 'codex' }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as IActiveProviderWire;
        assert.equal(body.activeProvider, 'codex');
        assert.equal(body.markerDrift, null, 'switching the lens clears the drift');

        // The refreshed snapshot landed on disk (claude + codex), mirroring
        // the CLI's `sm config set activeProvider`.
        const snapshot = readMarkersSnapshot(cwd) as string[];
        assert.ok(Array.isArray(snapshot));
        assert.ok(snapshot.includes('claude'));
        assert.ok(snapshot.includes('codex'));

        // A follow-up GET stays null (the drift does not reappear).
        const afterGet = (await (
          await fetch(url(handle, '/api/active-provider'))
        ).json()) as IActiveProviderWire;
        assert.equal(afterGet.markerDrift, null);
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
