/**
 * Mapper-digest surface (see `spec/provider-activity.md` §Mapper digest):
 * the ingest recording plus the `GET /api/activity/disclaimed` readback,
 * against a real `createServer()` and the real ingest pipeline.
 *
 * The archetype under test is the defect the digest exists for: an
 * adapter handed a payload in a vocabulary it does not speak disclaims
 * TOTALLY and silently, so every other checkpoint stays green (202 on
 * the wire, `installed` on disk) while the map stays dark. Here the
 * claude adapter is handed a lower-cased tool name whose path rides a
 * different key, which is exactly that shape.
 *
 * Coverage:
 *   - a vocabulary mismatch reports `received > 0`, `resolved: 0`, and
 *     names the keys the adapter was actually handed.
 *   - a payload the adapter DOES speak counts as resolved and records
 *     no shape, so a healthy provider reports a clean digest.
 *   - `?provider=` narrows; an unknown id reports zeroed, not an error.
 *   - the readback is content-free: no payload value reaches it.
 *   - a probe is NOT digested (it short-circuits before the mapper).
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import type { Node, ScanResult } from '../../../kernel/types.js';
import { PROBE_MARKER } from '../../../core/activity/probe.js';
import { createServer, type IServerHandle, type IServerOptions } from '../../index.js';

const HASH_BODY = 'a'.repeat(64);
const HASH_FRONTMATTER = 'b'.repeat(64);
const TOKEN_HEADER = 'x-skill-map-token';

/** Content the digest must never carry, planted in every value position. */
const SECRET = 'do-not-leak-this';

/** A payload the claude adapter DOES speak: model-invoked skill. */
const SPOKEN_PAYLOAD = {
  session_id: 'd3f1a9c0-1111-2222-3333-444455556666',
  cwd: '/home/user/project',
  hook_event_name: 'PreToolUse',
  tool_name: 'Skill',
  tool_input: { skill: 'deploy' },
  tool_use_id: 'toolu_015y8G9WHeDyRfLabuUTSoeL',
};

/**
 * The archetype: same runtime family, different vocabulary. Lower-cased
 * tool name, path under `path` instead of `file_path`. The adapter is
 * total by contract, so this disclaims without a word.
 */
const FOREIGN_PAYLOAD = {
  session_id: SECRET,
  cwd: '/home/user/project',
  hook_event_name: 'PreToolUse',
  tool_name: 'read',
  tool_input: { path: SECRET, offset: 1, limit: 200 },
};

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-activity-digest-'));
  root = { tmp, fixtureRoot: join(tmp, 'fixture'), dbPath: join(tmp, 'primed.db') };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  rmSync(root.dbPath, { force: true });
  await primeFixture();
});

async function primeFixture(): Promise<void> {
  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: [root.fixtureRoot],
    providers: ['claude'],
    nodes: [makeSkillNode('.claude/skills/deploy/SKILL.md')],
    links: [],
    issues: [],
    stats: {
      filesWalked: 1,
      filesSkipped: 0,
      nodesCount: 1,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
  const adapter = new SqliteStorageAdapter({ databasePath: root.dbPath, autoBackup: false });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
}

function makeSkillNode(path: string): Node {
  return {
    path,
    kind: 'skill',
    provider: 'claude',
    bodyHash: HASH_BODY,
    frontmatterHash: HASH_FRONTMATTER,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function defaultOptions(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: root.dbPath,
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
    runtimeContext: { cwd: root.fixtureRoot },
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

async function postActivity(
  handle: IServerHandle,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers[TOKEN_HEADER] = token;
  return fetch(url(handle, '/api/activity'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function readProbe(handle: IServerHandle, nonce: string): Promise<Response> {
  return fetch(url(handle, `/api/activity/probe?nonce=${encodeURIComponent(nonce)}`));
}


async function readDigest(handle: IServerHandle, provider?: string): Promise<Response> {
  const qs = provider === undefined ? '' : `?provider=${encodeURIComponent(provider)}`;
  return fetch(url(handle, `/api/activity/disclaimed${qs}`));
}

interface IDigestBody {
  providers: {
    id: string;
    received: number;
    resolved: number;
    shapes: { outcome: string; hook?: string; tool?: string; keys: string[]; count: number }[];
  }[];
}

describe('mapper digest', () => {
  it('reports a vocabulary mismatch as received-but-unmapped, with the keys', async () => {
    await bootAndUse(async (handle) => {
      for (let i = 0; i < 3; i += 1) {
        const res = await postActivity(
          handle,
          { provider: 'claude', event: FOREIGN_PAYLOAD },
          handle.activityToken,
        );
        // The silence the digest exists to break: still a clean 202.
        assert.equal(res.status, 202);
        assert.deepEqual(await res.json(), { ok: true, resolved: 0, spawns: 0 });
      }

      const body = (await (await readDigest(handle, 'claude')).json()) as IDigestBody;
      const entry = body.providers[0]!;
      assert.equal(entry.id, 'claude');
      assert.equal(entry.received, 3);
      assert.equal(entry.resolved, 0);
      assert.equal(entry.shapes.length, 1);

      const shape = entry.shapes[0]!;
      assert.equal(shape.count, 3);
      assert.equal(shape.outcome, 'no-signals');
      assert.equal(shape.hook, 'PreToolUse');
      assert.equal(shape.tool, 'read');
      assert.ok(shape.keys.includes('tool_input.path'));
    });
  });

  it('never carries a payload value to the readback', async () => {
    await bootAndUse(async (handle) => {
      await postActivity(
        handle,
        { provider: 'claude', event: FOREIGN_PAYLOAD },
        handle.activityToken,
      );
      const raw = await (await readDigest(handle)).text();
      assert.ok(!raw.includes(SECRET));
    });
  });

  it('records no shape for a payload the adapter speaks', async () => {
    await bootAndUse(async (handle) => {
      const res = await postActivity(
        handle,
        { provider: 'claude', event: SPOKEN_PAYLOAD },
        handle.activityToken,
      );
      assert.equal(res.status, 202);

      const body = (await (await readDigest(handle, 'claude')).json()) as IDigestBody;
      const entry = body.providers[0]!;
      assert.equal(entry.received, 1);
      assert.equal(entry.resolved, 1);
      assert.deepEqual(entry.shapes, []);
    });
  });

  it('reports an unknown provider as zeroed rather than erroring', async () => {
    await bootAndUse(async (handle) => {
      const res = await readDigest(handle, 'never-installed');
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()) as IDigestBody, {
        providers: [{ id: 'never-installed', received: 0, resolved: 0, shapes: [] }],
      });
    });
  });

  it('does not digest a wiring probe (it short-circuits before the mapper)', async () => {
    await bootAndUse(async (handle) => {
      await postActivity(
        handle,
        { provider: 'claude', event: { [PROBE_MARKER]: 'nonce-x' } },
        handle.activityToken,
      );
      const body = (await (await readDigest(handle)).json()) as IDigestBody;
      assert.deepEqual(body.providers, []);
    });
  });
});
