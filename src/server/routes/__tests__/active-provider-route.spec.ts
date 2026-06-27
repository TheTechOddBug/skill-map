/**
 * Integration tests for the BFF active-provider route's `selectable`
 * field.
 *
 *   GET /api/active-provider → `{ activeProvider, detected, source, selectable }`
 *
 * `selectable` is the set of registered LENS Provider ids (gated,
 * `gatedByActiveLens: true`) that are enabled right now (the subset of
 * `providerRegistry` eligible to become the lens). A lens the operator
 * disabled in `settings.json#/plugins` drops out of `selectable` even
 * though it stays in `providerRegistry`, which lets the SPA grey it out in
 * the dropdown. The non-gated `markdown` base is never in `selectable` (it
 * is the substrate, not a lens).
 *
 * Confirms:
 *   - enabled lenses are selectable: `claude` (stable), `antigravity` (beta),
 *     `codex` (beta), and `agent-skills` (stable, the locked open default).
 *     The non-gated `markdown` base is never selectable.
 *   - disabling a Provider's extension (`claude/claude`) drops only that
 *     lens from `selectable`; the rest stay (including the locked open
 *     default `agent-skills`).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

interface IActiveProviderWire {
  activeProvider: string;
  detected: string[];
  source: 'config' | 'autodetect' | 'default';
  selectable: string[];
}

let dbPath: string;

before(() => {
  // A path that never points at a real file: the fresh resolver then
  // degrades to the boot-cached resolver, which already read the cwd's
  // settings.json at server boot, exactly the read path this test wants.
  dbPath = join(mkdtempSync(join(tmpdir(), 'skill-map-active-prov-db-')), 'absent.db');
});

after(() => {
  rmSync(join(dbPath, '..'), { recursive: true, force: true });
});

function makeCwd(settings?: Record<string, unknown>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-map-active-prov-cwd-'));
  if (settings) {
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    writeFileSync(
      join(cwd, '.skill-map', 'settings.json'),
      JSON.stringify(settings, null, 2),
      'utf8',
    );
  }
  return cwd;
}

function options(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    // Real plugin runtime so the boot resolver reads the cwd's
    // settings.json `plugins` overrides; `emptyPluginRuntime`
    // (`noPlugins: true`) would hardwire "everything enabled".
    noPlugins: false,
    open: false,
    devCors: false,
    noWatcher: true,
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

describe('GET /api/active-provider selectable', () => {
  it('lists every built-in Provider when nothing is disabled', async () => {
    const cwd = makeCwd();
    try {
      await boot(cwd, async (handle) => {
        const res = await fetch(url(handle, '/api/active-provider'));
        assert.equal(res.status, 200);
        const body = (await res.json()) as IActiveProviderWire;
        assert.ok(Array.isArray(body.selectable));
        // Enabled lenses are selectable: claude (stable), antigravity (beta),
        // codex (beta), and agent-skills (stable, the locked open default).
        for (const id of ['claude', 'antigravity', 'codex', 'agent-skills']) {
          assert.ok(
            body.selectable.includes(id),
            `expected '${id}' to be selectable, got ${JSON.stringify(body.selectable)}`,
          );
        }
        // The non-gated `markdown` base is not a lens at all, never selectable.
        assert.ok(
          !body.selectable.includes('markdown'),
          `expected 'markdown' to be excluded, got ${JSON.stringify(body.selectable)}`,
        );
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('drops a disabled Provider from selectable but keeps the rest', async () => {
    const cwd = makeCwd({ plugins: { claude: { extensions: { claude: { enabled: false } } } } });
    try {
      await boot(cwd, async (handle) => {
        const res = await fetch(url(handle, '/api/active-provider'));
        assert.equal(res.status, 200);
        const body = (await res.json()) as IActiveProviderWire;
        assert.ok(
          !body.selectable.includes('claude'),
          `expected 'claude' to be excluded, got ${JSON.stringify(body.selectable)}`,
        );
        // Other selectable lenses are untouched: `codex` (beta) and the
        // locked open default `agent-skills` stay. The non-gated `markdown`
        // base is never selectable (it is the substrate, not a lens).
        assert.ok(body.selectable.includes('codex'));
        assert.ok(body.selectable.includes('agent-skills'));
        assert.ok(!body.selectable.includes('markdown'));
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
