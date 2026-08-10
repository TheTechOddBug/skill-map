/**
 * Integration tests for the BFF map-views routes (spec/map-views.md).
 *
 *   GET    /api/map-views         → { schemaVersion, kind, views, skipped }
 *   PUT    /api/map-views/:slug   → upsert one view, refreshed GET envelope
 *   DELETE /api/map-views/:slug   → remove one view, refreshed GET envelope
 *
 * Confirms:
 *   - GET reads an absent `views/` directory as zero views.
 *   - PUT writes the EXACT canonical bytes (LF, 2-space indent, single
 *     trailing newline, fixed top-level key order, byte-sorted pins,
 *     `description` / `groups` omitted when empty) and the written file
 *     validates against the REAL `spec/schemas/map-view.schema.json`
 *     (the inline-body-schema drift guard).
 *   - PUT is an upsert (same slug twice → one entry).
 *   - PUT / DELETE gate the slug against the Slug rule (400) and the
 *     body against the MapView shape (400).
 *   - `groups` round-trips verbatim (reserved wave-2 surface).
 *   - A broken view file is skipped per-file, never takes the list down.
 *   - DELETE returns 404 for an absent slug.
 *   - A successful PUT appends one `map-views.save` operations-log line.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadSchemaValidators } from '../../../kernel/adapters/schema-validators.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

interface IMapViewsEnvelopeWire {
  schemaVersion: string;
  kind: string;
  views: Array<{ slug: string; view: Record<string, unknown> }>;
  skipped: string[];
}

interface IErrorEnvelopeWire {
  ok: false;
  error: { code: string; message: string };
}

let tmp: string;
let dbPath: string;
let cwd: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-map-views-'));
  dbPath = join(tmp, 'primed.db');
  cwd = mkdtempSync(join(tmpdir(), 'skill-map-map-views-cwd-'));
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
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

function viewsDir(): string {
  return join(cwd, '.skill-map', 'views');
}

/** Reset the views directory so tests never see each other's files. */
function clearViews(): void {
  rmSync(viewsDir(), { recursive: true, force: true });
}

/** A minimal valid MapView document; spread overrides on top per test. */
function validDoc(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'map-view',
    name: 'Frontend focus',
    overrides: [
      ['', 'exclude'],
      ['src/app', 'include'],
    ],
    pins: {},
  };
}

async function putView(
  handle: IServerHandle,
  slug: string,
  body: unknown,
): Promise<Response> {
  return fetch(url(handle, `/api/map-views/${slug}`), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/map-views', () => {
  it('returns the empty envelope when the views directory is absent', async () => {
    clearViews();
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/map-views'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IMapViewsEnvelopeWire;
      assert.deepEqual(env, {
        schemaVersion: '1',
        kind: 'map-views',
        views: [],
        skipped: [],
      });
    });
  });

  it('skips a broken file per-file and lists the valid one', async () => {
    clearViews();
    mkdirSync(viewsDir(), { recursive: true });
    writeFileSync(join(viewsDir(), 'broken.json'), '{not json', 'utf8');
    writeFileSync(
      join(viewsDir(), 'ok.json'),
      `${JSON.stringify(validDoc(), null, 2)}\n`,
      'utf8',
    );
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/map-views'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IMapViewsEnvelopeWire;
      assert.deepEqual(
        env.views.map((v) => v.slug),
        ['ok'],
      );
      assert.deepEqual(env.skipped, ['broken.json']);
    });
  });
});

describe('PUT /api/map-views/:slug', () => {
  it('creates dir + file with the exact canonical bytes, validating against the spec schema', async () => {
    clearViews();
    await boot(async (handle) => {
      const res = await putView(handle, 'frontend-focus', {
        ...validDoc(),
        // Deliberately unsorted pins, empty description, empty groups:
        // the writer must byte-sort the pins and OMIT both empties.
        description: '',
        pins: {
          'z/last.md': { x: 10, y: 20 },
          'a/first.md': { x: -1.5, y: 0 },
        },
        groups: [],
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IMapViewsEnvelopeWire;
      assert.equal(env.schemaVersion, '1');
      assert.equal(env.kind, 'map-views');
      assert.deepEqual(
        env.views.map((v) => v.slug),
        ['frontend-focus'],
      );

      const raw = readFileSync(join(viewsDir(), 'frontend-focus.json'), 'utf8');
      const expected = [
        '{',
        '  "schemaVersion": 1,',
        '  "kind": "map-view",',
        '  "name": "Frontend focus",',
        '  "overrides": [',
        '    [',
        '      "",',
        '      "exclude"',
        '    ],',
        '    [',
        '      "src/app",',
        '      "include"',
        '    ]',
        '  ],',
        '  "pins": {',
        '    "a/first.md": {',
        '      "x": -1.5,',
        '      "y": 0',
        '    },',
        '    "z/last.md": {',
        '      "x": 10,',
        '      "y": 20',
        '    }',
        '  }',
        '}',
        '', // single trailing newline
      ].join('\n');
      assert.equal(raw, expected);
      assert.ok(!raw.includes('\r'), 'file must be LF-only');

      // Drift guard: the inline body schema in routes/map-views.ts is a
      // structural mirror of the spec schema; the written file must
      // validate against the REAL spec/schemas/map-view.schema.json.
      const check = loadSchemaValidators().validate('map-view', JSON.parse(raw));
      assert.equal(check.ok, true, check.ok ? '' : check.errors);
    });
  });

  it('upserts: same slug twice yields one entry', async () => {
    clearViews();
    await boot(async (handle) => {
      const first = await putView(handle, 'twice', validDoc());
      assert.equal(first.status, 200);
      const second = await putView(handle, 'twice', {
        ...validDoc(),
        name: 'Renamed',
      });
      assert.equal(second.status, 200);
      const env = (await second.json()) as IMapViewsEnvelopeWire;
      assert.deepEqual(
        env.views.map((v) => v.slug),
        ['twice'],
      );
      assert.equal(env.views[0]?.view['name'], 'Renamed');
    });
  });

  it('round-trips a non-empty groups array verbatim', async () => {
    clearViews();
    const groups = [
      {
        id: 'backend',
        label: 'Backend crew',
        color: '#3fb950',
        members: ['src/server/app.md', 'src/server/routes.md'],
        position: { x: 100, y: 200 },
        size: { width: 320, height: 240 },
      },
    ];
    await boot(async (handle) => {
      const res = await putView(handle, 'grouped', { ...validDoc(), groups });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IMapViewsEnvelopeWire;
      assert.deepEqual(env.views[0]?.view['groups'], groups);
      const onDisk = JSON.parse(
        readFileSync(join(viewsDir(), 'grouped.json'), 'utf8'),
      ) as Record<string, unknown>;
      assert.deepEqual(onDisk['groups'], groups);
    });
  });

  it('400 bad-query on every slug-rule violation', async () => {
    clearViews();
    // `a..b` is invalid on purpose: the Slug rule has no `.` in its
    // character class, so dots (and thus any `..` traversal shape) are
    // structurally excluded.
    const badSlugs = [
      'UPPER',
      'a..b',
      encodeURIComponent('has/slash'),
      'a'.repeat(65),
      '-leading',
      'trailing-',
    ];
    await boot(async (handle) => {
      for (const slug of badSlugs) {
        const res = await putView(handle, slug, validDoc());
        assert.equal(res.status, 400, `slug ${slug} must be rejected`);
        const env = (await res.json()) as IErrorEnvelopeWire;
        assert.equal(env.error.code, 'bad-query');
        assert.match(env.error.message, /slug/i);
      }
    });
  });

  it('400 bad-query on every body-shape violation', async () => {
    clearViews();
    const base = validDoc();
    const badBodies: Array<{ label: string; body: Record<string, unknown> }> = [
      { label: 'missing name', body: (() => { const b = { ...base }; delete b['name']; return b; })() },
      { label: 'override pair with 3 elements', body: { ...base, overrides: [['a', 'include', 'x']] } },
      { label: 'override state hide', body: { ...base, overrides: [['a', 'hide']] } },
      { label: 'pin without y', body: { ...base, pins: { 'a.md': { x: 1 } } } },
      { label: 'unknown top-level key', body: { ...base, bogus: true } },
      { label: 'group without label', body: { ...base, groups: [{ id: 'g1', members: [] }] } },
    ];
    await boot(async (handle) => {
      for (const { label, body } of badBodies) {
        const res = await putView(handle, 'gate', body);
        assert.equal(res.status, 400, `${label} must be rejected`);
        const env = (await res.json()) as IErrorEnvelopeWire;
        assert.equal(env.error.code, 'bad-query', label);
      }
    });
  });

  it('appends one map-views.save line to the operations log', async () => {
    clearViews();
    await boot(async (handle) => {
      const res = await putView(handle, 'ops-check', validDoc());
      assert.equal(res.status, 200);
      // `writeMapView` created `.skill-map/views/` before the append
      // ran, so the fire-and-forget writer found the project directory.
      const log = readFileSync(join(cwd, '.skill-map', 'operations.log'), 'utf8');
      const lines = log
        .split('\n')
        .filter((l) => l.includes('"op":"map-views.save"') && l.includes('"id":"ops-check"'));
      assert.equal(lines.length, 1);
    });
  });
});

describe('DELETE /api/map-views/:slug', () => {
  it('removes the view; the refreshed envelope no longer lists it', async () => {
    clearViews();
    await boot(async (handle) => {
      assert.equal((await putView(handle, 'doomed', validDoc())).status, 200);
      assert.equal((await putView(handle, 'kept', validDoc())).status, 200);
      const res = await fetch(url(handle, '/api/map-views/doomed'), {
        method: 'DELETE',
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IMapViewsEnvelopeWire;
      assert.deepEqual(
        env.views.map((v) => v.slug),
        ['kept'],
      );
      const refreshed = await fetch(url(handle, '/api/map-views'));
      const afterEnv = (await refreshed.json()) as IMapViewsEnvelopeWire;
      assert.deepEqual(
        afterEnv.views.map((v) => v.slug),
        ['kept'],
      );
    });
  });

  it('404 not-found for an absent slug', async () => {
    clearViews();
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/map-views/absent'), {
        method: 'DELETE',
      });
      assert.equal(res.status, 404);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'not-found');
    });
  });

  it('400 bad-query for a malformed slug', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/map-views/BAD'), {
        method: 'DELETE',
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });
});
