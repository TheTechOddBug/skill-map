/**
 * Audit M4, BFF body-limit middleware.
 *
 * Without an upper bound, a `c.req.json()` / `parseBody()` call inside
 * any POST/PATCH route buffers the entire payload in memory. Loopback-
 * only narrows the attack surface, the audit recommendation is to add
 * a defence-in-depth cap so a misbehaving client cannot exhaust the
 * server's heap. The fix mounts `hono/body-limit` globally on `/api/*`
 * at `BODY_LIMIT_BYTES` (1 MiB) and routes the resulting 413 through
 * the canonical error envelope (`code: 'payload-too-large'`).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { BODY_LIMIT_BYTES } from '../server/app.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../server/index.js';

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-body-limit-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function defaultOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    scope: 'project',
    dbPath: join(tmpRoot, 'never-existed.db'),
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
    ...overrides,
  };
}

async function bootAndUse<T>(
  options: IServerOptions,
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(options);
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

interface IErrorBody {
  ok: false;
  error: { code: string; message: string; details: unknown };
}

describe('audit M4, request body cap (1 MiB) on /api/*', () => {
  it('returns 413 + canonical envelope when the body exceeds the cap', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // Build a payload comfortably above the 1 MiB cap. Content-type
      // matches what `parseBody` expects so we hit the middleware
      // BEFORE the parser would have buffered the body.
      const payload = 'x'.repeat(BODY_LIMIT_BYTES + 1024);
      const res = await fetch(url(handle, '/api/sidecar/bump'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });
      assert.equal(res.status, 413);
      const body = (await res.json()) as IErrorBody;
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'payload-too-large');
      assert.equal(typeof body.error.message, 'string');
      assert.ok('details' in body.error, 'envelope must carry details key');
    });
  });

  it('accepts a small POST body without tripping the cap (regression guard)', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // Tiny malformed body, the body-limit middleware must NOT fire
      // (well under the cap), so the request reaches the route handler
      // and trips the normal `bad-query`/`internal` paths instead. The
      // assertion is "not 413", we tolerate any other status the
      // route happens to emit (404 for missing node, 400 for shape,
      // 500 for a missing DB). The whole point is the cap doesn't
      // misfire on legitimate small payloads.
      const res = await fetch(url(handle, '/api/sidecar/bump'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'does/not/exist.md' }),
      });
      assert.notEqual(res.status, 413, 'small body must not trip the body-limit');
    });
  });
});
