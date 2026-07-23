/**
 * Step 17 (BFF half), `POST /api/actions/:qualifiedId` integration tests.
 *
 * Generalises the retired `server-sidecar-endpoint` suite. Each test
 * boots a real `createServer()` against a primed-DB tempdir + matching
 * `.md` / `.sm` fixtures, fires a `fetch()` against the generic dispatch
 * route, and asserts on the REST envelope, the on-disk sidecar, the
 * broadcaster receipt, and (for the consent split) the on-disk
 * `allowEditSmFiles` flag.
 *
 * Coverage:
 *
 *   - 200: action resolves on a stale node -> `action.applied` envelope,
 *     version increments, broadcaster receives `action.applied`.
 *   - 404: unknown action id -> not-found, NO broadcast.
 *   - 409: refusal report (fresh node, no force) -> the report `reason`
 *     becomes the envelope `code`, NO broadcast.
 *   - 200: no-op report (force-on-fresh) -> `action.applied`, NO broadcast.
 *   - 404: unknown nodePath -> not-found.
 *   - 412: `allowEditSmFiles` false + no confirm/always -> confirm-required.
 *   - 200: `confirm: true` lets the write through but does NOT persist
 *     `allowEditSmFiles` (asserted: the flag stays false on disk).
 *   - 200: `always: true` persists `allowEditSmFiles: true` AND the next
 *     `GET /api/config` reflects the reload.
 *   - 400: malformed body (missing nodePath / wrong types / unknown key).
 *   - cross-cutting: the 200 envelope validates against
 *     `rest-envelope.schema.json` (action-result variant).
 *
 * Broadcaster receipts are observed by registering a fake
 * `IBroadcasterClient` directly on `handle.broadcaster` BEFORE issuing
 * the HTTP request (same pattern the legacy sidecar suite used).
 */

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';

import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { persistScanResult } from '../../../kernel/adapters/sqlite/scan-persistence.js';
import { _resetSidecarStoreValidatorCacheForTests } from '../../../kernel/sidecar/store.js';
import type { Node, ScanResult, SidecarStatus } from '../../../kernel/types.js';
import {
  createServer,
  type IBroadcasterClient,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

const BUMP_ACTION_ID = 'core/node-bump';

const HASH_LIVE_BODY = 'a'.repeat(64);
const HASH_LIVE_FRONTMATTER = 'b'.repeat(64);
// For the stale fixture the body hash differs (we mutate the body after
// the bump), so the kernel computes status: 'stale-body'. For the fresh
// fixture both match.
const HASH_OLD_BODY = 'c'.repeat(64);

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
}

let root: ITestRoot;
// Saved Git-config env so `after` can restore it (see the isolation note
// in `before`).
let savedGitEnv: { global: string | undefined; system: string | undefined };

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-actions-endpoint-'));
  const fixtureRoot = mkdtempSync(join(tmp, 'fixture-'));
  const dbPath = join(tmp, 'primed.db');
  root = { tmp, fixtureRoot, dbPath };
  // The bump route stamps `audit.lastBumpedBy` with the resolved Git author
  // (`resolveGitAuthorName(cwd) ?? 'ui'`); these tests assert the `'ui'`
  // fallback, so the resolution must yield nothing. Isolate Git config so a
  // developer's global `user.name` cannot leak into the stamp, the fixture
  // lives under `tmpdir()`, and a stray `.git` above it (e.g. a junk
  // `/tmp/.git`) would otherwise make the resolver read the global name.
  // `git config` consults only the global + system files; pointing both at
  // `/dev/null` makes the name empty and the route falls back to `'ui'`,
  // hermetic regardless of the host's Git setup.
  savedGitEnv = {
    global: process.env['GIT_CONFIG_GLOBAL'],
    system: process.env['GIT_CONFIG_SYSTEM'],
  };
  process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
  process.env['GIT_CONFIG_SYSTEM'] = '/dev/null';
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
  restoreEnv('GIT_CONFIG_GLOBAL', savedGitEnv.global);
  restoreEnv('GIT_CONFIG_SYSTEM', savedGitEnv.system);
});

function restoreEnv(key: string, prior: string | undefined): void {
  if (prior === undefined) delete process.env[key];
  else process.env[key] = prior;
}

beforeEach(async () => {
  // Re-prime the DB + fixtures from scratch on every test so a previous
  // test's sidecar mutation (or persisted consent flag) doesn't leak.
  _resetSidecarStoreValidatorCacheForTests();
  rmSync(root.fixtureRoot, { recursive: true, force: true });
  mkdirSync(root.fixtureRoot, { recursive: true });
  rmSync(root.dbPath, { force: true });
  // Default fixture pre-grants `.sm` write consent so the happy-path
  // tests need no `confirm`/`always` in every body. The consent split
  // tests re-prime WITHOUT the grant (see `primeFixture(false)`).
  await primeFixture(true);
});

/**
 * Plant two `.md` nodes (one stale, one fresh) and persist them with
 * matching sidecar overlays into a fresh SQLite DB. Plant the
 * accompanying `.sm` files on disk so the bump Action's writes land on a
 * real file the test can re-read.
 *
 * @param grantConsent when true, writes
 *   `.skill-map/settings.local.json` with `allowEditSmFiles: true` so
 *   writes proceed without a `confirm`/`always` body. The consent tests
 *   pass `false` to exercise the 412 / one-shot / persist paths.
 */
async function primeFixture(grantConsent: boolean): Promise<void> {
  mkdirSync(join(root.fixtureRoot, '.skill-map'), { recursive: true });
  // `core/node-bump` ships `defaultEnabled: false` and the dispatch route
  // re-checks the live enabled state (disabled -> 404), so the fixture
  // opts it in explicitly; the disabled-dispatch test overrides this.
  writeFileSync(
    join(root.fixtureRoot, '.skill-map', 'settings.json'),
    JSON.stringify({
      plugins: { core: { extensions: { 'node-bump': { enabled: true } } } },
    }),
    'utf8',
  );
  if (grantConsent) {
    writeFileSync(
      join(root.fixtureRoot, '.skill-map', 'settings.local.json'),
      JSON.stringify({ allowEditSmFiles: true }),
      'utf8',
    );
  }

  // --- stale node ---------------------------------------------------------
  const stalePath = 'docs/stale.md';
  writeFile(stalePath, '---\nname: stale\n---\nlive body content\n');
  writeFile('docs/stale.sm', yamlDump({
    identity: {
      path: stalePath,
      bodyHash: HASH_OLD_BODY,
      frontmatterHash: HASH_LIVE_FRONTMATTER,
    },
    annotations: { version: 3 },
  }));

  // --- fresh node ---------------------------------------------------------
  const freshPath = 'docs/fresh.md';
  writeFile(freshPath, '---\nname: fresh\n---\nlive body content\n');
  writeFile('docs/fresh.sm', yamlDump({
    identity: {
      path: freshPath,
      bodyHash: HASH_LIVE_BODY,
      frontmatterHash: HASH_LIVE_FRONTMATTER,
    },
    annotations: { version: 7 },
  }));

  const result: ScanResult = {
    schemaVersion: 1,
    scannedAt: Date.now(),
    roots: [root.fixtureRoot],
    providers: ['claude'],
    nodes: [
      makeNode(stalePath, 'stale-body', 3),
      makeNode(freshPath, 'fresh', 7),
    ],
    links: [],
    issues: [],
    stats: {
      filesWalked: 2,
      filesSkipped: 0,
      nodesCount: 2,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };

  const adapter = new SqliteStorageAdapter({
    databasePath: root.dbPath,
    autoBackup: false,
  });
  await adapter.init();
  try {
    await persistScanResult(adapter.db, result);
  } finally {
    await adapter.close();
  }
}

function makeNode(
  nodePath: string,
  status: SidecarStatus,
  version: number,
): Node {
  return {
    path: nodePath,
    kind: 'agent',
    provider: 'claude',
    bodyHash: HASH_LIVE_BODY,
    frontmatterHash: HASH_LIVE_FRONTMATTER,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    sidecar: {
      present: true,
      status,
      annotations: { version },
    },
  };
}

function writeFile(rel: string, content: string): void {
  const abs = join(root.fixtureRoot, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function readConsentFlag(): unknown {
  const p = join(root.fixtureRoot, '.skill-map', 'settings.local.json');
  if (!existsSync(p)) return undefined;
  const parsed = yamlLoad(readFileSync(p, 'utf8')) as Record<string, unknown> | null;
  return parsed?.['allowEditSmFiles'];
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
  };
}

async function bootAndUse<T>(
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
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

function actionUrl(handle: IServerHandle, actionId: string): string {
  return url(handle, `/api/actions/${actionId}`);
}

interface IFakeClient extends IBroadcasterClient {
  sent: string[];
}

function makeFakeClient(): IFakeClient {
  const sent: string[] = [];
  return {
    sent,
    bufferedAmount: 0,
    readyState: 1,
    send(data: string): void {
      sent.push(data);
    },
    close(): void { /* no-op */ },
  };
}

interface IActionAppliedEnvelope {
  schemaVersion: string;
  kind: string;
  value: { actionId: string; nodePath: string; report: Record<string, unknown> };
  elapsedMs: number;
}

describe('POST /api/actions/:pluginId/:actionId', () => {
  it('200: action resolves on a stale node -> action.applied + broadcast', async () => {
    await bootAndUse(async (handle) => {
      const client = makeFakeClient();
      handle.broadcaster.register(client);

      const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/stale.md' }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IActionAppliedEnvelope;
      assert.equal(env.schemaVersion, '1');
      assert.equal(env.kind, 'action.applied');
      assert.equal(env.value.actionId, BUMP_ACTION_ID);
      assert.equal(env.value.nodePath, 'docs/stale.md');
      assert.equal(env.value.report['ok'], true);
      assert.equal(env.value.report['version'], 4); // 3 -> 4
      assert.ok(typeof env.elapsedMs === 'number');

      // On-disk sidecar reflects the new version + invoker stamp.
      const parsed = yamlLoad(
        readFileSync(join(root.fixtureRoot, 'docs/stale.sm'), 'utf8'),
      ) as Record<string, unknown>;
      assert.equal((parsed['annotations'] as Record<string, unknown>)['version'], 4);
      assert.equal((parsed['audit'] as Record<string, unknown>)['lastBumpedBy'], 'ui');

      // Broadcaster fan-out, canonical `{ type, timestamp, data }`.
      assert.equal(client.sent.length, 1);
      const event = JSON.parse(client.sent[0]!) as Record<string, unknown>;
      assert.equal(event['type'], 'action.applied');
      assert.match(
        event['timestamp'] as string,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      const data = event['data'] as Record<string, unknown>;
      assert.equal(data['actionId'], BUMP_ACTION_ID);
      assert.equal(data['nodePath'], 'docs/stale.md');
      assert.equal((data['report'] as Record<string, unknown>)['version'], 4);
      // No flat siblings on the envelope itself.
      assert.equal(event['actionId'], undefined);
      assert.equal(event['nodePath'], undefined);
    });
  });

  it('404: unknown action id -> not-found, NO broadcast', async () => {
    await bootAndUse(async (handle) => {
      const client = makeFakeClient();
      handle.broadcaster.register(client);

      const res = await fetch(actionUrl(handle, 'core/does-not-exist'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/stale.md' }),
      });
      assert.equal(res.status, 404);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'not-found');
      assert.equal(client.sent.length, 0);

      // Sidecar untouched.
      const parsed = yamlLoad(
        readFileSync(join(root.fixtureRoot, 'docs/stale.sm'), 'utf8'),
      ) as Record<string, unknown>;
      assert.equal((parsed['annotations'] as Record<string, unknown>)['version'], 3);
    });
  });

  it('404: DISABLED action id -> not-found, NO broadcast (surface follows the plugin)', async () => {
    // Drop the fixture's bump opt-in: with NO explicit settings entry the
    // extension falls back to its installed default (`core/node-bump`
    // ships `defaultEnabled: false`), so the route must refuse exactly
    // like an unknown id. This is the sharper regression: the gate has to
    // derive the installed default from the registered manifest, not
    // assume enabled-unless-config-says-otherwise.
    writeFileSync(
      join(root.fixtureRoot, '.skill-map', 'settings.json'),
      JSON.stringify({}),
      'utf8',
    );
    await bootAndUse(async (handle) => {
      const client = makeFakeClient();
      handle.broadcaster.register(client);

      const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/stale.md' }),
      });
      assert.equal(res.status, 404);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'not-found');
      assert.equal(client.sent.length, 0);

      // Sidecar untouched: the disabled action never ran.
      const parsed = yamlLoad(
        readFileSync(join(root.fixtureRoot, 'docs/stale.sm'), 'utf8'),
      ) as Record<string, unknown>;
      assert.equal((parsed['annotations'] as Record<string, unknown>)['version'], 3);
    });
  });

  it('409: refusal report (fresh node, no force) -> reason becomes code, NO broadcast', async () => {
    await bootAndUse(async (handle) => {
      const client = makeFakeClient();
      handle.broadcaster.register(client);

      const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/fresh.md' }),
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as {
        ok: boolean;
        error: { code: string; details: { report: Record<string, unknown> } };
      };
      assert.equal(body.ok, false);
      // `node-bump`'s refusal report carries `reason: 'fresh'`, which the
      // route promotes to the envelope `code`.
      assert.equal(body.error.code, 'fresh');
      assert.equal(body.error.details.report['ok'], false);
      assert.equal(body.error.details.report['reason'], 'fresh');

      // Sidecar untouched + no broadcast.
      const parsed = yamlLoad(
        readFileSync(join(root.fixtureRoot, 'docs/fresh.sm'), 'utf8'),
      ) as Record<string, unknown>;
      assert.equal((parsed['annotations'] as Record<string, unknown>)['version'], 7);
      assert.equal(parsed['audit'], undefined);
      assert.equal(client.sent.length, 0);
    });
  });

  it('200: no-op report (force-on-fresh) -> action.applied, NO broadcast', async () => {
    await bootAndUse(async (handle) => {
      const client = makeFakeClient();
      handle.broadcaster.register(client);

      const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/fresh.md', input: { force: true } }),
      });
      assert.equal(res.status, 200);
      const env = (await res.json()) as IActionAppliedEnvelope;
      assert.equal(env.kind, 'action.applied');
      assert.equal(env.value.report['noop'], true);

      // Sidecar untouched on disk; no broadcast on no-op.
      const parsed = yamlLoad(
        readFileSync(join(root.fixtureRoot, 'docs/fresh.sm'), 'utf8'),
      ) as Record<string, unknown>;
      assert.equal((parsed['annotations'] as Record<string, unknown>)['version'], 7);
      assert.equal(parsed['audit'], undefined, 'force-on-fresh is a no-op; audit MUST NOT be stamped');
      assert.equal(client.sent.length, 0);
    });
  });

  it('404: unknown nodePath -> not-found', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/never-existed.md' }),
      });
      assert.equal(res.status, 404);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'not-found');
    });
  });

  describe('consent split (no pre-granted consent)', () => {
    beforeEach(async () => {
      _resetSidecarStoreValidatorCacheForTests();
      rmSync(root.fixtureRoot, { recursive: true, force: true });
      mkdirSync(root.fixtureRoot, { recursive: true });
      rmSync(root.dbPath, { force: true });
      await primeFixture(false);
    });

    it('412: no confirm/always + flag false -> confirm-required, details.key', async () => {
      await bootAndUse(async (handle) => {
        const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nodePath: 'docs/stale.md' }),
        });
        assert.equal(res.status, 412);
        const body = (await res.json()) as {
          error: { code: string; details: { key: string } };
        };
        assert.equal(body.error.code, 'confirm-required');
        assert.equal(body.error.details.key, 'allowEditSmFiles');

        // Sidecar unchanged + flag never persisted.
        const parsed = yamlLoad(
          readFileSync(join(root.fixtureRoot, 'docs/stale.sm'), 'utf8'),
        ) as Record<string, unknown>;
        assert.equal((parsed['annotations'] as Record<string, unknown>)['version'], 3);
        assert.equal(readConsentFlag(), undefined);
      });
    });

    it('200: confirm:true lets the write through but does NOT persist allowEditSmFiles', async () => {
      await bootAndUse(async (handle) => {
        const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nodePath: 'docs/stale.md', confirm: true }),
        });
        assert.equal(res.status, 200);
        const env = (await res.json()) as IActionAppliedEnvelope;
        assert.equal(env.value.report['version'], 4);

        // Write landed.
        const parsed = yamlLoad(
          readFileSync(join(root.fixtureRoot, 'docs/stale.sm'), 'utf8'),
        ) as Record<string, unknown>;
        assert.equal((parsed['annotations'] as Record<string, unknown>)['version'], 4);

        // One-shot grant: the flag is NOT persisted to disk.
        assert.equal(
          readConsentFlag(),
          undefined,
          'confirm:true is one-shot; allowEditSmFiles MUST stay unset',
        );
      });
    });

    it('200: always:true persists allowEditSmFiles:true AND the reload exposes it', async () => {
      await bootAndUse(async (handle) => {
        const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nodePath: 'docs/stale.md', always: true }),
        });
        assert.equal(res.status, 200);

        // Write landed + flag persisted to project-local settings.
        const parsed = yamlLoad(
          readFileSync(join(root.fixtureRoot, 'docs/stale.sm'), 'utf8'),
        ) as Record<string, unknown>;
        assert.equal((parsed['annotations'] as Record<string, unknown>)['version'], 4);
        assert.equal(readConsentFlag(), true, 'always:true MUST persist allowEditSmFiles');

        // The route called `configService.reload()`; the live config now
        // reflects the granted flag.
        const cfgRes = await fetch(url(handle, '/api/config'));
        assert.equal(cfgRes.status, 200);
        const cfg = (await cfgRes.json()) as { value: Record<string, unknown> };
        assert.equal(cfg.value['allowEditSmFiles'], true);
      });
    });
  });

  describe('allowSidecarWriters policy (hard gate)', () => {
    beforeEach(() => {
      // The outer beforeEach already primed with consent granted
      // (settings.local.json: allowEditSmFiles=true). Layer the committed
      // team policy on top: settings.json forbids sidecar writers. The
      // policy must win over the local consent.
      writeFileSync(
        join(root.fixtureRoot, '.skill-map', 'settings.json'),
        JSON.stringify({
          allowSidecarWriters: false,
          // Keep the bump opt-in from the base fixture (this overwrite
          // replaces the whole file): without it the dispatch 404s on the
          // enabled gate before the policy under test is ever consulted.
          plugins: { core: { extensions: { 'node-bump': { enabled: true } } } },
        }),
        'utf8',
      );
    });

    it('403: sidecar-writers-forbidden even with allowEditSmFiles granted locally', async () => {
      await bootAndUse(async (handle) => {
        const client = makeFakeClient();
        handle.broadcaster.register(client);

        const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nodePath: 'docs/stale.md', always: true }),
        });
        assert.equal(res.status, 403);
        const body = (await res.json()) as {
          ok: boolean;
          error: { code: string; details: { key: string } };
        };
        assert.equal(body.ok, false);
        assert.equal(body.error.code, 'sidecar-writers-forbidden');
        assert.equal(body.error.details.key, 'allowSidecarWriters');

        // Sidecar untouched + no broadcast: the policy refused the write.
        const parsed = yamlLoad(
          readFileSync(join(root.fixtureRoot, 'docs/stale.sm'), 'utf8'),
        ) as Record<string, unknown>;
        assert.equal((parsed['annotations'] as Record<string, unknown>)['version'], 3);
        assert.equal(client.sent.length, 0);
      });
    });
  });

  it('400: missing nodePath -> bad-query', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { force: true } }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('400: wrong type (confirm as string) -> bad-query', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/stale.md', confirm: 'yes' }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('400: unknown body key (additionalProperties strict) -> bad-query', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/stale.md', forced: true }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'bad-query');
    });
  });

  it('400: malformed JSON body -> bad-query', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      });
      assert.equal(res.status, 400);
    });
  });

  it('200 envelope validates against rest-envelope.schema.json (action-result variant)', async () => {
    const validate = compileEnvelopeValidator();
    await bootAndUse(async (handle) => {
      const res = await fetch(actionUrl(handle, BUMP_ACTION_ID), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nodePath: 'docs/stale.md' }),
      });
      assert.equal(res.status, 200);
      const env = await res.json();
      const ok = validate(env);
      assert.equal(
        ok,
        true,
        `envelope must validate: ${JSON.stringify(validate.errors)}`,
      );
    });
  });
});

/**
 * Resolve and AJV-compile `spec/schemas/api/rest-envelope.schema.json`.
 */
function compileEnvelopeValidator(): ReturnType<Ajv2020['compile']> {
  const require = createRequire(import.meta.url);
  const indexPath = require.resolve('@skill-map/spec/index.json');
  const specRoot = dirname(indexPath);
  const schemaPath = resolve(specRoot, 'schemas/api/rest-envelope.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const viewSlotsPath = resolve(specRoot, 'schemas/view-slots.schema.json');
  ajv.addSchema(JSON.parse(readFileSync(viewSlotsPath, 'utf8')) as object);
  return ajv.compile(schema);
}
