/**
 * Acceptance tests for Mode A plugin storage end to end:
 * `port.pluginKvs` (the `state_plugin_kvs` namespace on
 * `SqliteStorageAdapter`) driven through the plugin-facing `KvStore`
 * wrapper exactly the way a real scan wires it
 * (`core/runtime/plugin-stores.ts` binds the two together).
 *
 * Normative reference: `spec/plugin-kv-api.md` § Mode A (Interface,
 * Scoping, Semantics, Key constraints, Value constraints, Errors) and
 * `spec/db-schema.md` § `state_plugin_kvs`.
 *
 * Coverage:
 *   - round-trip `set` → `get`, including overwrite semantics;
 *   - `get` of a missing key returns `null` and never throws;
 *   - `delete` returns `true` then `false` (idempotent);
 *   - `list` with and without a key prefix, ordered key ASC;
 *   - a LIKE metacharacter in the prefix is matched literally;
 *   - global (`nodePath` omitted / null) and node-scoped rows coexist
 *     under the same key without colliding;
 *   - two plugins sharing a key never observe each other's value;
 *   - an oversized key is a typed rejection, a long-but-legal key is not;
 *   - a cyclic value (and one carrying `undefined`) is a typed rejection
 *     that leaves no row behind;
 *   - the Mode A AJV gate still fires on `set` and never on `get`/`list`.
 *
 * The adapter is opened against a real file (see the repo note: the
 * SQLite adapter cannot run on `:memory:`, `init()` opens two distinct
 * connections).
 */

import { after, before, describe, it } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Ajv2020 } from 'ajv/dist/2020.js';

import { SqliteStorageAdapter } from '../index.js';
import {
  KV_KEY_MAX_BYTES,
  KV_KEY_WARN_MAX_TRACKED,
  KV_PLUGIN_MAX_TOTAL_BYTES,
  KV_SCHEMA_KEY,
  KV_VALUE_MAX_BYTES,
  makeKvStoreWrapper,
} from '../../plugin-store.js';
import type {
  IKvPersistedRow,
  IKvStorePersist,
  IKvStoreWrapper,
} from '../../plugin-store.js';
import {
  KvKeyInvalidError,
  KvNodePathInvalidError,
  KvValueNotSerializableError,
  KvValueTooLargeError,
} from '../../plugin-store-errors.js';
import { makeKvPersist } from '../../../../core/runtime/plugin-stores.js';
import type { IPluginStorageSchema } from '../../../types/plugin.js';

let dbRoot: string;
let dbCounter = 0;

function freshDbPath(label: string): string {
  dbCounter += 1;
  return join(dbRoot, `${label}-${dbCounter}.db`);
}

before(() => {
  dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-plugin-kvs-'));
});

after(() => {
  rmSync(dbRoot, { recursive: true, force: true });
});

/**
 * Open a real adapter and hand back KV wrappers bound to the requested
 * plugin ids, wired the same way `buildPluginStores` wires them during
 * a scan. `close` releases the DB.
 */
async function openStores(
  label: string,
  pluginIds: readonly string[],
  schemas: ReadonlyMap<string, IPluginStorageSchema> = new Map(),
): Promise<{
  adapter: SqliteStorageAdapter;
  stores: Map<string, IKvStoreWrapper>;
  close: () => Promise<void>;
}> {
  const adapter = new SqliteStorageAdapter({
    databasePath: freshDbPath(label),
    autoBackup: false,
  });
  await adapter.init();
  const stores = new Map<string, IKvStoreWrapper>();
  for (const pluginId of pluginIds) {
    stores.set(
      pluginId,
      makeKvStoreWrapper({
        pluginId,
        schema: schemas.get(pluginId),
        persist: makeKvPersist(adapter, pluginId),
      }),
    );
  }
  return { adapter, stores, close: () => adapter.close() };
}

/** Single-plugin variant that captures the advisory channel. */
async function openStoreWithWarn(
  label: string,
): Promise<{ store: IKvStoreWrapper; warnings: string[]; close: () => Promise<void> }> {
  const adapter = new SqliteStorageAdapter({
    databasePath: freshDbPath(label),
    autoBackup: false,
  });
  await adapter.init();
  const warnings: string[] = [];
  const store = makeKvStoreWrapper({
    pluginId: 'demo',
    schema: undefined,
    persist: makeKvPersist(adapter, 'demo'),
    warn: (message) => warnings.push(message),
  });
  return { store, warnings, close: () => adapter.close() };
}

function compileSchema(schema: object, schemaPath: string): IPluginStorageSchema {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return {
    schemaPath,
    validate: ajv.compile(schema) as IPluginStorageSchema['validate'],
  };
}

describe('Mode A KV store, CRUD round-trip', () => {
  it('set then get returns the decoded value; a second set overwrites', async () => {
    const { stores, close } = await openStores('roundtrip', ['demo']);
    try {
      const store = stores.get('demo')!;
      await store.set('feature.flags', { enabled: true, tries: 3 });
      deepStrictEqual(await store.get('feature.flags'), { enabled: true, tries: 3 });

      await store.set('feature.flags', { enabled: false, tries: 4 });
      deepStrictEqual(await store.get('feature.flags'), { enabled: false, tries: 4 });

      const entries = await store.list();
      strictEqual(entries.length, 1, 'upsert, not insert');
    } finally {
      await close();
    }
  });

  it('round-trips every JSON primitive shape, including null and false', async () => {
    const { stores, close } = await openStores('primitives', ['demo']);
    try {
      const store = stores.get('demo')!;
      await store.set('a.string', 'hello');
      await store.set('a.number', 0);
      await store.set('a.false', false);
      await store.set('a.null', null);
      await store.set('a.array', [1, 'two', null]);

      strictEqual(await store.get('a.string'), 'hello');
      strictEqual(await store.get('a.number'), 0);
      strictEqual(await store.get('a.false'), false);
      // A stored `null` is indistinguishable from "missing" by design,
      // the spec's `get` contract returns `null` for both.
      strictEqual(await store.get('a.null'), null);
      deepStrictEqual(await store.get('a.array'), [1, 'two', null]);
    } finally {
      await close();
    }
  });

  it('get of a missing key returns null and does not throw', async () => {
    const { stores, close } = await openStores('missing', ['demo']);
    try {
      const store = stores.get('demo')!;
      strictEqual(await store.get('never.written'), null);
      strictEqual(await store.get('never.written', { nodePath: 'skills/a.md' }), null);
      deepStrictEqual(await store.list(), []);
    } finally {
      await close();
    }
  });

  it('delete returns true for an existing row, false afterwards (idempotent)', async () => {
    const { stores, close } = await openStores('delete', ['demo']);
    try {
      const store = stores.get('demo')!;
      await store.set('gone.soon', { x: 1 });
      strictEqual(await store.delete('gone.soon'), true);
      strictEqual(await store.delete('gone.soon'), false);
      strictEqual(await store.get('gone.soon'), null);
      // Never-existed key behaves the same way.
      strictEqual(await store.delete('never.existed'), false);
    } finally {
      await close();
    }
  });
});

describe('Mode A KV store, list', () => {
  it('returns the scope entries key-ascending, with nodePath null for globals', async () => {
    const { stores, close } = await openStores('list-order', ['demo']);
    try {
      const store = stores.get('demo')!;
      await store.set('zeta', 3);
      await store.set('alpha', 1);
      await store.set('mid', 2);

      const entries = await store.list();
      deepStrictEqual(
        entries.map((e) => e.key),
        ['alpha', 'mid', 'zeta'],
      );
      deepStrictEqual(
        entries.map((e) => e.value),
        [1, 2, 3],
      );
      ok(entries.every((e) => e.nodePath === null), 'global rows surface nodePath: null');
      ok(
        entries.every((e) => typeof e.updatedAt === 'number' && e.updatedAt > 0),
        'updatedAt is a populated epoch',
      );
    } finally {
      await close();
    }
  });

  it('prefix narrows to matching keys only', async () => {
    const { stores, close } = await openStores('list-prefix', ['demo']);
    try {
      const store = stores.get('demo')!;
      await store.set('cache.a', 1);
      await store.set('cache.b', 2);
      await store.set('pref.a', 3);

      deepStrictEqual(
        (await store.list({ prefix: 'cache.' })).map((e) => e.key),
        ['cache.a', 'cache.b'],
      );
      deepStrictEqual(
        (await store.list({ prefix: 'pref.' })).map((e) => e.key),
        ['pref.a'],
      );
      deepStrictEqual(await store.list({ prefix: 'nothing.' }), []);
      // No prefix: the whole scope.
      strictEqual((await store.list()).length, 3);
    } finally {
      await close();
    }
  });

  it('prefix is CASE-SENSITIVE, "starts with" means exactly that', async () => {
    // Audit M3: the first implementation used SQLite `LIKE`, which is
    // case-insensitive for ASCII unless `case_sensitive_like` is set,
    // so `prefix: 'cache.'` also returned `Cache.secret`. The `substr`
    // comparison that replaced it is BINARY-collated.
    const { stores, close } = await openStores('list-case', ['demo']);
    try {
      const store = stores.get('demo')!;
      await store.set('cache.public', 1);
      await store.set('Cache.secret', 2);
      await store.set('CACHE.other', 3);

      deepStrictEqual(
        (await store.list({ prefix: 'cache.' })).map((e) => e.key),
        ['cache.public'],
        'a lowercase prefix must not match capitalised keys',
      );
      deepStrictEqual(
        (await store.list({ prefix: 'Cache.' })).map((e) => e.key),
        ['Cache.secret'],
        'a capitalised prefix must not match the lowercase key',
      );
      deepStrictEqual(
        (await store.list({ prefix: 'CACHE.' })).map((e) => e.key),
        ['CACHE.other'],
      );
    } finally {
      await close();
    }
  });

  it('matches an astral (multi-code-unit) prefix, code points not UTF-16 units', async () => {
    // `substr` counts code points in SQLite; measuring the prefix with
    // `.length` would over-count an astral char and match nothing.
    const { stores, close } = await openStores('list-astral', ['demo']);
    try {
      const store = stores.get('demo')!;
      await store.set('🎯target.a', 1);
      await store.set('other.b', 2);

      deepStrictEqual(
        (await store.list({ prefix: '🎯' })).map((e) => e.key),
        ['🎯target.a'],
      );
    } finally {
      await close();
    }
  });

  it('treats LIKE metacharacters in the prefix literally', async () => {
    const { stores, close } = await openStores('list-like', ['demo']);
    try {
      const store = stores.get('demo')!;
      await store.set('100%.done', 1);
      await store.set('100X.done', 2);
      await store.set('a_b', 3);
      await store.set('axb', 4);

      deepStrictEqual(
        (await store.list({ prefix: '100%' })).map((e) => e.key),
        ['100%.done'],
        'the % must not act as a wildcard',
      );
      deepStrictEqual(
        (await store.list({ prefix: 'a_' })).map((e) => e.key),
        ['a_b'],
        'the _ must not act as a single-char wildcard',
      );
    } finally {
      await close();
    }
  });
});

describe('Mode A KV store, scoping', () => {
  it('global and node-scoped rows share a key without colliding', async () => {
    const { stores, close } = await openStores('scope', ['demo']);
    try {
      const store = stores.get('demo')!;
      await store.set('last.seen', 'global');
      await store.set('last.seen', 'node-a', { nodePath: 'skills/a.md' });
      await store.set('last.seen', 'node-b', { nodePath: 'skills/b.md' });

      strictEqual(await store.get('last.seen'), 'global');
      strictEqual(await store.get('last.seen', { nodePath: 'skills/a.md' }), 'node-a');
      strictEqual(await store.get('last.seen', { nodePath: 'skills/b.md' }), 'node-b');

      // Explicit null is the same scope as omitted (spec § Semantics).
      strictEqual(await store.get('last.seen', { nodePath: null }), 'global');

      const globals = await store.list();
      strictEqual(globals.length, 1);
      strictEqual(globals[0]?.nodePath, null);

      const nodeA = await store.list({ nodePath: 'skills/a.md' });
      strictEqual(nodeA.length, 1);
      strictEqual(nodeA[0]?.nodePath, 'skills/a.md');
      strictEqual(nodeA[0]?.value, 'node-a');

      // Deleting the node-scoped row leaves the global one alone.
      strictEqual(await store.delete('last.seen', { nodePath: 'skills/a.md' }), true);
      strictEqual(await store.get('last.seen'), 'global');
    } finally {
      await close();
    }
  });

  it('rejects an empty-string nodePath instead of aliasing the global sentinel', async () => {
    // Audit L1: `nodePath ?? sentinel` only caught null / undefined, so
    // an explicit `''` WAS the global scope. A plugin deriving the path
    // from a value that came out empty would have folded every
    // per-node row into one global row, last write wins.
    const { stores, adapter, close } = await openStores('nodepath-empty', ['demo']);
    try {
      const store = stores.get('demo')!;
      await store.set('k', 'global-value');

      await rejects(
        () => store.set('k', 'node-value', { nodePath: '' }),
        (err: Error) => {
          ok(err instanceof KvNodePathInvalidError, 'typed rejection');
          ok(err.message.includes('sentinel'), 'names the reason');
          return true;
        },
      );
      await rejects(() => store.get('k', { nodePath: '' }), KvNodePathInvalidError);
      await rejects(() => store.delete('k', { nodePath: '' }), KvNodePathInvalidError);
      await rejects(() => store.list({ nodePath: '' }), KvNodePathInvalidError);

      strictEqual(await store.get('k'), 'global-value', 'the global row is untouched');
      const rows = await adapter.db.selectFrom('state_plugin_kvs').select(['key']).execute();
      strictEqual(rows.length, 1, 'the rejected write never reached the table');
    } finally {
      await close();
    }
  });

  it('rejects a non-string nodePath with a typed error, not an opaque backend failure', async () => {
    const { stores, close } = await openStores('nodepath-type', ['demo']);
    try {
      const store = stores.get('demo')!;
      const bogus = 42 as unknown as string;
      await rejects(
        () => store.set('k', 1, { nodePath: bogus }),
        (err: Error) => {
          ok(err instanceof KvNodePathInvalidError, 'typed, not KvOperationFailedError');
          ok(err.message.includes('number'), 'names the received type');
          return true;
        },
      );
      await rejects(() => store.get('k', { nodePath: bogus }), KvNodePathInvalidError);
    } finally {
      await close();
    }
  });

  it('two plugins writing the same key never see each other', async () => {
    const { stores, adapter, close } = await openStores('isolation', ['alpha', 'beta']);
    try {
      const alpha = stores.get('alpha')!;
      const beta = stores.get('beta')!;

      await alpha.set('shared.key', 'from-alpha');
      await beta.set('shared.key', 'from-beta');
      await alpha.set('shared.key', 'from-alpha-node', { nodePath: 'skills/x.md' });
      await beta.set('shared.key', 'from-beta-node', { nodePath: 'skills/x.md' });

      strictEqual(await alpha.get('shared.key'), 'from-alpha');
      strictEqual(await beta.get('shared.key'), 'from-beta');
      strictEqual(await alpha.get('shared.key', { nodePath: 'skills/x.md' }), 'from-alpha-node');
      strictEqual(await beta.get('shared.key', { nodePath: 'skills/x.md' }), 'from-beta-node');

      // `list` is scoped too: one row each, not two.
      strictEqual((await alpha.list()).length, 1);
      strictEqual((await beta.list()).length, 1);

      // Deleting alpha's row does not touch beta's.
      strictEqual(await alpha.delete('shared.key'), true);
      strictEqual(await alpha.get('shared.key'), null);
      strictEqual(await beta.get('shared.key'), 'from-beta');

      // The physical table really holds separately-owned rows.
      const rows = await adapter.db
        .selectFrom('state_plugin_kvs')
        .select(['pluginId', 'nodeId', 'key'])
        .orderBy('pluginId', 'asc')
        .orderBy('nodeId', 'asc')
        .execute();
      deepStrictEqual(
        rows.map((r) => `${r.pluginId}|${r.nodeId}|${r.key}`),
        [
          'alpha|skills/x.md|shared.key',
          'beta||shared.key',
          'beta|skills/x.md|shared.key',
        ],
        'global rows use the empty-string node_id sentinel',
      );
    } finally {
      await close();
    }
  });
});

describe('Mode A KV store, key and value constraints', () => {
  it('rejects an oversized key with KvKeyInvalidError and writes nothing', async () => {
    const { stores, adapter, close } = await openStores('key-limit', ['demo']);
    try {
      const store = stores.get('demo')!;
      const tooLong = 'k'.repeat(KV_KEY_MAX_BYTES + 1);
      await rejects(
        () => store.set(tooLong, 1),
        (err: Error) => {
          ok(err instanceof KvKeyInvalidError, 'typed rejection');
          ok(err.message.includes('demo'), 'names the plugin');
          return true;
        },
      );
      await rejects(() => store.get(tooLong), KvKeyInvalidError);
      await rejects(() => store.delete(tooLong), KvKeyInvalidError);
      await rejects(() => store.set('', 1), KvKeyInvalidError);

      const count = await adapter.db
        .selectFrom('state_plugin_kvs')
        .select(['key'])
        .execute();
      strictEqual(count.length, 0, 'no row survived a rejected key');
    } finally {
      await close();
    }
  });

  it('measures the key ceiling in UTF-8 bytes, not code units', async () => {
    const { stores, close } = await openStores('key-bytes', ['demo']);
    try {
      const store = stores.get('demo')!;
      // 'é' is 2 bytes; 200 of them is 400 bytes but only 200 chars, so
      // a `.length` check would wrongly accept it.
      await rejects(() => store.set('é'.repeat(200), 1), KvKeyInvalidError);
      // Exactly at the ceiling is accepted.
      const exact = 'k'.repeat(KV_KEY_MAX_BYTES);
      await store.set(exact, 'ok');
      strictEqual(await store.get(exact), 'ok');
    } finally {
      await close();
    }
  });

  it('accepts a key past the soft limit and routes one advisory to warn', async () => {
    const { store, warnings, close } = await openStoreWithWarn('key-soft');
    try {
      const longish = 'k'.repeat(200); // > 128 soft limit, < 256 hard limit
      await store.set(longish, 1);
      await store.set(longish, 2);
      strictEqual(await store.get(longish), 2, 'accepted, never rejected');
      strictEqual(warnings.length, 1, 'advisory is emitted once per key');
      ok(warnings[0]?.includes('demo'));
      // A short key produces no advisory at all.
      await store.set('short', 1);
      strictEqual(warnings.length, 1);
    } finally {
      await close();
    }
  });

  it('rejects a cyclic value with KvValueNotSerializableError, not a raw TypeError', async () => {
    const { stores, adapter, close } = await openStores('cyclic', ['demo']);
    try {
      const store = stores.get('demo')!;
      const cyclic: Record<string, unknown> = { name: 'loop' };
      cyclic['self'] = cyclic;

      await rejects(
        () => store.set('bad.value', cyclic),
        (err: Error) => {
          ok(err instanceof KvValueNotSerializableError, 'typed rejection');
          ok(!(err instanceof TypeError), 'not the raw JSON.stringify TypeError');
          ok(err.message.includes('bad.value'), 'names the key');
          return true;
        },
      );

      const rows = await adapter.db.selectFrom('state_plugin_kvs').select(['key']).execute();
      strictEqual(rows.length, 0, 'nothing persisted for a rejected value');
    } finally {
      await close();
    }
  });

  it('rejects an over-1-MiB encoded value with KvValueTooLargeError, carrying the byte count', async () => {
    const { stores, adapter, close } = await openStores('value-limit', ['demo']);
    try {
      const store = stores.get('demo')!;
      // A JSON string of N chars encodes to N + 2 bytes (the quotes),
      // so exactly-at-the-cap plus one char is over.
      const oversized = 'x'.repeat(KV_VALUE_MAX_BYTES);
      await rejects(
        () => store.set('too.big', oversized),
        (err: Error) => {
          ok(err instanceof KvValueTooLargeError, 'typed rejection');
          ok(err.bytes > KV_VALUE_MAX_BYTES, 'reports the measured size');
          strictEqual(err.key, 'too.big');
          return true;
        },
      );
      const rows = await adapter.db.selectFrom('state_plugin_kvs').select(['key']).execute();
      strictEqual(rows.length, 0, 'nothing persisted for an oversized value');

      // Just under the cap still goes through.
      const fits = 'x'.repeat(KV_VALUE_MAX_BYTES - 2);
      await store.set('just.fits', fits);
      strictEqual(await store.get('just.fits'), fits);
    } finally {
      await close();
    }
  });

  it('drops __proto__ and constructor on decode (no prototype-pollution gadget)', async () => {
    // Audit L2: `JSON.parse` never invokes the `__proto__` setter, so a
    // stored gadget decodes into an OWN property and is handed straight
    // to plugin code. The reviver deletes it before that happens.
    const { stores, adapter, close } = await openStores('proto', ['demo']);
    try {
      const store = stores.get('demo')!;
      // Written through the raw port so the encode-side guard (which
      // has no reason to reject a legal key name) is not what is under
      // test here.
      await adapter.pluginKvs.set({
        pluginId: 'demo',
        nodeId: '',
        key: 'gadget',
        valueJson: '{"__proto__":{"polluted":"yes"},"constructor":{"x":1},"a":1}',
        updatedAt: Date.now(),
      });

      const decoded = (await store.get('gadget')) as Record<string, unknown>;
      deepStrictEqual(decoded, { a: 1 }, 'only the benign key survives');
      strictEqual(
        Object.prototype.hasOwnProperty.call(decoded, '__proto__'),
        false,
        '__proto__ must not survive as an own property',
      );
      strictEqual(Object.prototype.hasOwnProperty.call(decoded, 'constructor'), false);
      strictEqual(
        ({} as Record<string, unknown>)['polluted'],
        undefined,
        'Object.prototype stays clean',
      );

      // `list` decodes through the same path.
      const [entry] = await store.list();
      deepStrictEqual(entry?.value, { a: 1 });
    } finally {
      await close();
    }
  });

  it('rejects values carrying undefined, a function, or a bigint', async () => {
    const { stores, close } = await openStores('nonserializable', ['demo']);
    try {
      const store = stores.get('demo')!;
      await rejects(() => store.set('u', undefined), KvValueNotSerializableError);
      await rejects(
        () => store.set('nested.u', { a: 1, b: undefined }),
        KvValueNotSerializableError,
      );
      await rejects(
        () => store.set('fn', { run: () => 1 }),
        KvValueNotSerializableError,
      );
      await rejects(
        () => store.set('big', { n: 10n }),
        KvValueNotSerializableError,
      );
      deepStrictEqual(await store.list(), []);
    } finally {
      await close();
    }
  });
});

describe('Mode A KV store, declared value schema', () => {
  const schema = compileSchema(
    {
      type: 'object',
      required: ['enabled'],
      properties: { enabled: { type: 'boolean' } },
      additionalProperties: false,
    },
    'schemas/kv-value.schema.json',
  );

  it('set is AJV-gated; get and list return what is stored without validating', async () => {
    const { stores, adapter, close } = await openStores(
      'ajv',
      ['demo'],
      new Map([['demo', schema]]),
    );
    try {
      const store = stores.get('demo')!;
      await store.set('flag', { enabled: true });
      deepStrictEqual(await store.get('flag'), { enabled: true });

      await rejects(
        () => store.set('flag', { enabled: 'yes' }),
        (err: Error) => {
          ok(err.message.includes('demo'));
          ok(err.message.includes('kv-value.schema.json'));
          return true;
        },
      );
      deepStrictEqual(
        await store.get('flag'),
        { enabled: true },
        'the rejected set left the prior value intact',
      );

      // A row written before the schema existed (or by an operator)
      // still reads back: the read side never validates.
      await adapter.pluginKvs.set({
        pluginId: 'demo',
        nodeId: '',
        key: 'legacy',
        valueJson: JSON.stringify({ shape: 'off-schema' }),
        updatedAt: Date.now(),
      });
      deepStrictEqual(await store.get('legacy'), { shape: 'off-schema' });
      const listed = await store.list();
      deepStrictEqual(
        listed.map((e) => e.key),
        ['flag', 'legacy'],
      );
    } finally {
      await close();
    }
  });

  it('KV_SCHEMA_KEY is the sentinel a discovered plugin stores its Mode A schema under', () => {
    strictEqual(KV_SCHEMA_KEY, '__kv__');
  });
});

/**
 * Terminal-safety and volume advisories. Audit M1 (a plugin controls
 * the key, the key reaches `printer.warn`, `printer.warn` is a bare
 * `stderr.write`) and M2 (nothing bounded the advisory set or the
 * aggregate write volume).
 *
 * These exercise wrapper semantics only, so they run against an
 * in-memory persist double rather than SQLite: the aggregate case
 * would otherwise have to push 16 MiB through a real file to prove a
 * counter, which buys no coverage and costs seconds.
 *
 * Control bytes are written as `\u` escapes so this file stays free of
 * raw ESC / NUL / BEL, which would be invisible in a diff.
 */
const ESC = '\u001B';
const NUL = '\u0000';
const BEL = '\u0007';

/** In-memory persist double, exposing its rows so a test can assert what landed. */
function memoryPersist(): IKvStorePersist & { rows: () => IKvPersistedRow[] } {
  const rows = new Map<string, IKvPersistedRow>();
  const id = (nodeId: string, key: string): string => `${nodeId} ${key}`;
  return {
    get: (nodeId, key) => rows.get(id(nodeId, key)) ?? null,
    set: (nodeId, key, valueJson, updatedAt) => {
      rows.set(id(nodeId, key), { nodeId, key, valueJson, updatedAt });
    },
    delete: (nodeId, key) => rows.delete(id(nodeId, key)),
    list: (nodeId) => [...rows.values()].filter((row) => row.nodeId === nodeId),
    rows: () => [...rows.values()],
  };
}

function warnCapturingStore(pluginId = 'demo'): {
  store: IKvStoreWrapper;
  warnings: string[];
  rows: () => IKvPersistedRow[];
} {
  const warnings: string[] = [];
  const persist = memoryPersist();
  const store = makeKvStoreWrapper({
    pluginId,
    schema: undefined,
    persist,
    warn: (message) => warnings.push(message),
  });
  return { store, warnings, rows: persist.rows };
}

describe('Mode A KV store, terminal safety of advisories and errors', () => {
  it('strips ANSI / control bytes from the plugin-controlled key before it reaches warn', async () => {
    const { store, warnings } = warnCapturingStore();
    // Over the 128-byte soft limit so the advisory fires, carrying an
    // ANSI screen-clear + cursor-home, a bare CR (line-overwrite
    // spoofing), a NUL and a BEL.
    const hostile = `${ESC}[2J${ESC}[1;1H\r${NUL}${BEL}BANNER ${'k'.repeat(150)}`;
    await store.set(hostile, 1);

    strictEqual(warnings.length, 1);
    const line = warnings[0]!;
    ok(!line.includes(ESC), 'no ESC survives');
    ok(!line.includes(NUL), 'no NUL survives');
    ok(!line.includes(BEL), 'no BEL survives');
    ok(!/\r(?!\n)/u.test(line), 'no bare CR survives');
    ok(line.includes('BANNER'), 'the printable text is kept, only the controls go');
  });

  it('terminates the advisory with a newline (printer.warn never appends one)', async () => {
    const { store, warnings } = warnCapturingStore();
    await store.set('k'.repeat(150), 1);
    strictEqual(warnings.length, 1);
    ok(warnings[0]!.endsWith('\n'), 'advisory carries its own line ending');
  });

  it('caps the rendered key so a long key cannot flood the line', async () => {
    const { store, warnings } = warnCapturingStore();
    await store.set('k'.repeat(250), 1);
    strictEqual(warnings.length, 1);
    ok(warnings[0]!.includes('\u2026'), 'the rendered key is truncated');
    ok(warnings[0]!.length < 400, `line stayed bounded, got ${warnings[0]!.length}`);
  });

  it('sanitizes the key in a REJECTION message too, where it is unbounded', async () => {
    const { store } = warnCapturingStore();
    // Rejected keys never pass the 256-byte accept check, so the render
    // cap is the only thing bounding them.
    const hostile = `${ESC}[31mred${ESC}[0m${'x'.repeat(5000)}`;
    await rejects(
      () => store.set(hostile, 1),
      (err: Error) => {
        ok(err instanceof KvKeyInvalidError);
        ok(!err.message.includes(ESC), 'no ESC in the error message');
        ok(err.message.length < 500, `message stayed bounded, got ${err.message.length}`);
        return true;
      },
    );
  });

  it('sanitizes the plugin id, which is a directory name read off disk', async () => {
    const { store } = warnCapturingStore(`evil${ESC}[2Jplugin`);
    await rejects(
      () => store.set('', 1),
      (err: Error) => {
        ok(err instanceof KvKeyInvalidError);
        ok(!err.message.includes(ESC), 'no ESC from the plugin id');
        return true;
      },
    );
  });
});

describe('Mode A KV store, volume advisories', () => {
  it('bounds the long-key advisory set so a per-node unique key cannot leak memory', async () => {
    const { store, warnings } = warnCapturingStore();
    // One distinct long key per "node", well past the tracking cap.
    for (let i = 0; i < KV_KEY_WARN_MAX_TRACKED + 25; i += 1) {
      await store.set(`${'k'.repeat(150)}-${i}`, 1);
    }
    strictEqual(
      warnings.length,
      KV_KEY_WARN_MAX_TRACKED,
      'advisories stop at the cap instead of growing with the corpus',
    );
  });

  it('rejects the write that would cross the per-plugin budget, persisting nothing', async () => {
    const { store, rows } = warnCapturingStore();
    const CHUNK = 512 * 1024;
    const chunk = 'x'.repeat(CHUNK);
    // Fill to just under the ceiling, then take one more step over it.
    const fits = Math.floor(KV_PLUGIN_MAX_TOTAL_BYTES / (CHUNK + 32));
    for (let i = 0; i < fits; i += 1) await store.set(`bulk.${i}`, chunk);
    const before = rows().length;

    await rejects(
      () => store.set('bulk.over', chunk),
      (err: Error) => {
        strictEqual(err.name, 'KvBudgetExceededError');
        ok(err.message.includes('demo'), 'names the plugin');
        ok(err.message.includes('bulk.over'), 'names the key');
        return true;
      },
    );
    strictEqual(rows().length, before, 'the rejected write persisted nothing');

    // The budget is not consumed by a rejected write, so a SMALL value
    // still fits afterwards: the plugin is throttled, not bricked.
    await store.set('small', 'ok');
    strictEqual(await store.get('small'), 'ok');
  });

  it('never trips for a plugin writing a normal metadata volume', async () => {
    const { store, warnings } = warnCapturingStore();
    // 5,000 nodes x a ~200-byte record, the realistic shape.
    for (let i = 0; i < 5000; i += 1) {
      await store.set(`node.${i}`, { seen: true, at: i, note: 'x'.repeat(150) });
    }
    deepStrictEqual(warnings, [], 'no advisory for legitimate per-node metadata');
    strictEqual(await store.get('node.4999') !== null, true, 'every write landed');
  });
});
