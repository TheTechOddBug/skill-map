/**
 * Integration tests for the BFF project-ignore route.
 *
 *   GET   /api/project-ignore        → current envelope { patterns }
 *   PATCH /api/project-ignore        → replace the active pattern list
 *
 * Confirms:
 *   - GET returns [] when `.skillmapignore` is absent.
 *   - GET drops comments + blanks but keeps every pattern.
 *   - PATCH writes the file, preserving comments + blank lines.
 *   - PATCH rejects shape errors (non-array, non-string entries,
 *     entries with control chars, empty / whitespace-only entries,
 *     duplicates).
 *   - PATCH does not gate on disk-access (no 412 branch).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

interface IIgnoreEnvelopeWire {
  patterns: string[];
}

interface IErrorEnvelopeWire {
  ok: false;
  error: { code: string; message: string };
}

let tmp: string;
let dbPath: string;
let cwd: string;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-map-proj-ignore-'));
  dbPath = join(tmp, 'primed.db');
  cwd = mkdtempSync(join(tmpdir(), 'skill-map-proj-ignore-cwd-'));
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

function writeIgnoreFile(content: string): void {
  writeFileSync(join(cwd, '.skillmapignore'), content, 'utf8');
}

function readIgnoreFile(): string {
  return readFileSync(join(cwd, '.skillmapignore'), 'utf8');
}

function clearIgnoreFile(): void {
  try {
    rmSync(join(cwd, '.skillmapignore'), { force: true });
  } catch {
    /* ignore */
  }
}

describe('GET /api/project-ignore', () => {
  it('returns empty patterns when .skillmapignore is absent', async () => {
    clearIgnoreFile();
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-ignore'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IIgnoreEnvelopeWire;
      assert.deepEqual(env, { patterns: [] });
    });
  });

  it('drops comments + blanks, returns patterns trimmed', async () => {
    writeIgnoreFile('# header\n\nnode_modules/\n  dist/  \n');
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-ignore'));
      assert.equal(res.status, 200);
      const env = (await res.json()) as IIgnoreEnvelopeWire;
      assert.deepEqual(env.patterns, ['node_modules/', 'dist/']);
    });
  });
});

describe('PATCH /api/project-ignore', () => {
  it('writes a fresh file when none exists', async () => {
    clearIgnoreFile();
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-ignore'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patterns: ['node_modules/', 'dist/'] }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IIgnoreEnvelopeWire;
      assert.deepEqual(env.patterns, ['node_modules/', 'dist/']);
      assert.equal(readIgnoreFile(), 'node_modules/\ndist/\n');
    });
  });

  it('preserves comments + blanks across a write', async () => {
    writeIgnoreFile(
      '# header\n\nnode_modules/\n# middle\ndist/\n# trailing\n',
    );
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-ignore'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patterns: ['node_modules/', 'coverage/'] }),
      });
      assert.equal(res.status, 200);
      assert.equal(
        readIgnoreFile(),
        '# header\n\nnode_modules/\n# middle\n# trailing\ncoverage/\n',
      );
    });
  });

  it('400 when body has no patterns key', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-ignore'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
    });
  });

  it('400 when patterns is not an array', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-ignore'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patterns: 'node_modules/' }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /patterns/);
    });
  });

  it('400 when a pattern carries a newline', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-ignore'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patterns: ['ok/', 'bad\nentry'] }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /single line|control characters/i);
    });
  });

  it('400 when a pattern is whitespace-only', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-ignore'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patterns: ['ok/', '   '] }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /empty|whitespace/i);
    });
  });

  it('400 on duplicate patterns (after trim)', async () => {
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-ignore'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patterns: ['dist/', '  dist/  '] }),
      });
      assert.equal(res.status, 400);
      const env = (await res.json()) as IErrorEnvelopeWire;
      assert.equal(env.error.code, 'bad-query');
      assert.match(env.error.message, /Duplicate|duplicate/);
    });
  });

  it('200 when patterns list is empty (clearing the file)', async () => {
    writeIgnoreFile('a\nb\n');
    await boot(async (handle) => {
      const res = await fetch(url(handle, '/api/project-ignore'), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patterns: [] }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IIgnoreEnvelopeWire;
      assert.deepEqual(env.patterns, []);
      assert.equal(readIgnoreFile(), '');
    });
  });
});
