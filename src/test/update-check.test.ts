/**
 * Acceptance tests for the update-check feature:
 *   - `core/update-check`         — pure helpers (compareVersions,
 *                                   isOutdated, fetchLatestVersion).
 *   - `kernel/storage/update-check` — preferences-row round-trip via
 *                                   `port.preferences.{load,save}UpdateCheckCache`.
 *   - `cli/util/update-check-banner` — bail conditions and end-to-end
 *                                   "stale cache → fetch → persist"
 *                                   wiring with a stubbed `fetch`.
 *
 * Mocking strategy: this codebase is `node:test` (no Vitest), so
 * `globalThis.fetch` is replaced with a simple closure for the
 * duration of each test; environment variables are saved / restored
 * by hand. The `IUpdateCheckCache` row is read straight off the
 * adapter to keep assertions independent from the helpers under test.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import {
  compareVersions,
  fetchLatestVersion,
  isOutdated,
  type IUpdateCheckCache,
} from '../core/update-check/index.js';
import { SqliteStorageAdapter } from '../kernel/adapters/sqlite/index.js';
import { UPDATE_CHECK_KEY } from '../kernel/storage/update-check.js';
import { maybeRunUpdateCheck } from '../cli/util/update-check-banner.js';
import { VERSION } from '../version.js';

// ---------------------------------------------------------------------------
// compareVersions / isOutdated
// ---------------------------------------------------------------------------

describe('compareVersions', () => {
  it('orders patch versions', () => {
    assert.equal(compareVersions('0.18.0', '0.18.1'), -1);
    assert.equal(compareVersions('0.18.1', '0.18.0'), 1);
  });

  it('orders minor versions', () => {
    assert.equal(compareVersions('0.18.0', '0.19.0'), -1);
    assert.equal(compareVersions('0.19.0', '0.18.0'), 1);
  });

  it('orders major versions', () => {
    assert.equal(compareVersions('0.18.0', '1.0.0'), -1);
    assert.equal(compareVersions('1.0.0', '0.18.0'), 1);
  });

  it('returns 0 for equal versions', () => {
    assert.equal(compareVersions('0.18.0', '0.18.0'), 0);
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  });

  it('treats a release as greater than its prerelease', () => {
    assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
    assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1);
  });

  it('orders prereleases by identifier', () => {
    assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1);
    assert.equal(compareVersions('1.0.0-rc.1', '1.0.0-rc.2'), -1);
    // numeric < alpha at the same field
    assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1);
    // shorter prerelease (with all earlier fields equal) is smaller
    assert.equal(compareVersions('1.0.0-rc', '1.0.0-rc.1'), -1);
  });

  it('ignores build metadata', () => {
    assert.equal(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
    assert.equal(compareVersions('1.0.0', '1.0.0+build.1'), 0);
  });

  it('returns 0 for malformed input (caller treats as "not outdated")', () => {
    assert.equal(compareVersions('not-a-version', '1.0.0'), 0);
    assert.equal(compareVersions('1.0.0', 'garbage'), 0);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('', ''), 0);
  });
});

describe('isOutdated', () => {
  it('true when latest > current', () => {
    assert.equal(isOutdated('0.18.0', '0.19.0'), true);
    assert.equal(isOutdated('0.18.0', '0.18.1'), true);
    assert.equal(isOutdated('1.0.0-rc.1', '1.0.0'), true);
  });

  it('false when latest == current', () => {
    assert.equal(isOutdated('0.18.0', '0.18.0'), false);
  });

  it('false when current > latest (e.g. dev build ahead of npm)', () => {
    assert.equal(isOutdated('0.20.0', '0.19.0'), false);
  });

  it('false on malformed input', () => {
    assert.equal(isOutdated('not-a-version', '1.0.0'), false);
  });
});

// ---------------------------------------------------------------------------
// fetchLatestVersion (with stubbed `fetch`)
// ---------------------------------------------------------------------------

describe('fetchLatestVersion', () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('returns the version field from a 200 JSON payload', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version: '0.42.0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const got = await fetchLatestVersion('@skill-map/cli', { timeoutMs: 1000 });
    assert.equal(got, '0.42.0');
  });

  it('throws on non-2xx status', async () => {
    globalThis.fetch = (async () =>
      new Response('not found', { status: 404 })) as typeof fetch;
    await assert.rejects(
      () => fetchLatestVersion('@skill-map/cli', { timeoutMs: 1000 }),
      /status 404/,
    );
  });

  it('throws when the payload lacks a string `version` field', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: 'foo' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await assert.rejects(
      () => fetchLatestVersion('@skill-map/cli', { timeoutMs: 1000 }),
      /missing string `version`/,
    );
  });

  it('aborts on timeout (AbortError surfaces as a rejection)', async () => {
    // Stall longer than the timeout; fetch must still reject because
    // the AbortController fires.
    globalThis.fetch = ((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          (err as { name?: string }).name = 'AbortError';
          reject(err);
        });
      });
    }) as typeof fetch;
    await assert.rejects(
      () => fetchLatestVersion('@skill-map/cli', { timeoutMs: 20 }),
      /aborted/i,
    );
  });
});

// ---------------------------------------------------------------------------
// kernel/storage/update-check round-trip
// ---------------------------------------------------------------------------

describe('port.preferences.{load,save}UpdateCheckCache', () => {
  let dbRoot: string;
  let dbCounter = 0;

  function freshDbPath(label: string): string {
    dbCounter += 1;
    return join(dbRoot, `${label}-${dbCounter}.db`);
  }

  before(() => {
    dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-update-check-'));
  });

  after(() => {
    rmSync(dbRoot, { recursive: true, force: true });
  });

  it('returns null on first read (no row yet)', async () => {
    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('empty'),
      autoBackup: false,
    });
    await adapter.init();
    try {
      const got = await adapter.preferences.loadUpdateCheckCache();
      assert.equal(got, null);
    } finally {
      await adapter.close();
    }
  });

  it('round-trips a cache payload', async () => {
    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('roundtrip'),
      autoBackup: false,
    });
    await adapter.init();
    try {
      const payload: IUpdateCheckCache = {
        latestVersion: '0.42.0',
        checkedAt: 1_700_000_000_000,
        shownAt: null,
      };
      await adapter.preferences.saveUpdateCheckCache(payload);
      const got = await adapter.preferences.loadUpdateCheckCache();
      assert.deepEqual(got, payload);
    } finally {
      await adapter.close();
    }
  });

  it('upsert overwrites in place', async () => {
    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('upsert'),
      autoBackup: false,
    });
    await adapter.init();
    try {
      await adapter.preferences.saveUpdateCheckCache({
        latestVersion: '0.42.0',
        checkedAt: 100,
        shownAt: null,
      });
      await adapter.preferences.saveUpdateCheckCache({
        latestVersion: '0.43.0',
        checkedAt: 200,
        shownAt: 150,
      });
      const got = await adapter.preferences.loadUpdateCheckCache();
      assert.deepEqual(got, {
        latestVersion: '0.43.0',
        checkedAt: 200,
        shownAt: 150,
      });
      // exactly one row
      const rows = await adapter.db
        .selectFrom('config_preferences')
        .select(['key'])
        .where('key', '=', UPDATE_CHECK_KEY)
        .execute();
      assert.equal(rows.length, 1);
    } finally {
      await adapter.close();
    }
  });

  it('returns null on malformed JSON (corrupt row → ignore)', async () => {
    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('malformed'),
      autoBackup: false,
    });
    await adapter.init();
    try {
      await adapter.db
        .insertInto('config_preferences')
        .values({
          key: UPDATE_CHECK_KEY,
          valueJson: '{not-json',
          updatedAt: Date.now(),
        })
        .execute();
      const got = await adapter.preferences.loadUpdateCheckCache();
      assert.equal(got, null);
    } finally {
      await adapter.close();
    }
  });

  it('returns null when the JSON shape is wrong', async () => {
    const adapter = new SqliteStorageAdapter({
      databasePath: freshDbPath('shape'),
      autoBackup: false,
    });
    await adapter.init();
    try {
      await adapter.db
        .insertInto('config_preferences')
        .values({
          key: UPDATE_CHECK_KEY,
          valueJson: JSON.stringify({ latestVersion: 42 }),
          updatedAt: Date.now(),
        })
        .execute();
      const got = await adapter.preferences.loadUpdateCheckCache();
      assert.equal(got, null);
    } finally {
      await adapter.close();
    }
  });
});

// ---------------------------------------------------------------------------
// maybeRunUpdateCheck — bail conditions + end-to-end happy path
// ---------------------------------------------------------------------------

describe('maybeRunUpdateCheck (banner + refresh wiring)', () => {
  let dbRoot: string;
  let dbCounter = 0;

  // env state we mutate
  let originalCi: string | undefined;
  let originalSm: string | undefined;
  let originalFetch: typeof fetch;

  function freshDbPath(label: string): string {
    dbCounter += 1;
    return join(dbRoot, `${label}-${dbCounter}.db`);
  }

  /** Synthetic stderr capture with `isTTY` toggleable per test. */
  function fakeStderr(isTTY: boolean): {
    stream: NodeJS.WriteStream;
    captured: () => string;
  } {
    let buffer = '';
    const stream = {
      isTTY,
      write(chunk: string | Uint8Array): boolean {
        buffer += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    return { stream, captured: () => buffer };
  }

  /** Prime a project DB with a stale, outdated cache row. */
  async function primeDb(
    dbPath: string,
    seed: IUpdateCheckCache | null,
  ): Promise<void> {
    const adapter = new SqliteStorageAdapter({
      databasePath: dbPath,
      autoBackup: false,
    });
    await adapter.init();
    try {
      if (seed) await adapter.preferences.saveUpdateCheckCache(seed);
    } finally {
      await adapter.close();
    }
  }

  async function readCache(dbPath: string): Promise<IUpdateCheckCache | null> {
    const adapter = new SqliteStorageAdapter({
      databasePath: dbPath,
      autoBackup: false,
    });
    await adapter.init();
    try {
      return await adapter.preferences.loadUpdateCheckCache();
    } finally {
      await adapter.close();
    }
  }

  before(() => {
    dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-update-banner-'));
  });

  after(() => {
    rmSync(dbRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    originalCi = process.env['CI'];
    originalSm = process.env['SM_NO_UPDATE_CHECK'];
    originalFetch = globalThis.fetch;
    delete process.env['CI'];
    delete process.env['SM_NO_UPDATE_CHECK'];
  });

  afterEach(() => {
    if (originalCi === undefined) delete process.env['CI'];
    else process.env['CI'] = originalCi;
    if (originalSm === undefined) delete process.env['SM_NO_UPDATE_CHECK'];
    else process.env['SM_NO_UPDATE_CHECK'] = originalSm;
    globalThis.fetch = originalFetch;
  });

  it('bails silently when stderr is not a TTY (no banner, no fetch)', async () => {
    const dbPath = freshDbPath('no-tty');
    await primeDb(dbPath, {
      latestVersion: '99.99.99',
      checkedAt: Date.now(),
      shownAt: null,
    });
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const { stream, captured } = fakeStderr(false);
    await maybeRunUpdateCheck({
      dbPath,
      cwd: dbRoot,
      homedir: dbRoot,
      stderr: stream,
      noColorFlag: true,
    });
    assert.equal(captured(), '');
    assert.equal(fetchCalled, false);
  });

  it('bails when CI=true', async () => {
    process.env['CI'] = 'true';
    const dbPath = freshDbPath('ci');
    await primeDb(dbPath, {
      latestVersion: '99.99.99',
      checkedAt: Date.now(),
      shownAt: null,
    });
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const { stream, captured } = fakeStderr(true);
    await maybeRunUpdateCheck({
      dbPath,
      cwd: dbRoot,
      homedir: dbRoot,
      stderr: stream,
      noColorFlag: true,
    });
    assert.equal(captured(), '');
    assert.equal(fetchCalled, false);
  });

  it('bails when SM_NO_UPDATE_CHECK=1', async () => {
    process.env['SM_NO_UPDATE_CHECK'] = '1';
    const dbPath = freshDbPath('opt-out');
    await primeDb(dbPath, {
      latestVersion: '99.99.99',
      checkedAt: Date.now(),
      shownAt: null,
    });
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const { stream, captured } = fakeStderr(true);
    await maybeRunUpdateCheck({
      dbPath,
      cwd: dbRoot,
      homedir: dbRoot,
      stderr: stream,
      noColorFlag: true,
    });
    assert.equal(captured(), '');
    assert.equal(fetchCalled, false);
  });

  it('bails when the project DB does not exist', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const { stream, captured } = fakeStderr(true);
    await maybeRunUpdateCheck({
      dbPath: join(dbRoot, 'does-not-exist.db'),
      cwd: dbRoot,
      homedir: dbRoot,
      stderr: stream,
      noColorFlag: true,
    });
    assert.equal(captured(), '');
    assert.equal(fetchCalled, false);
  });

  it('emits the banner when the cache is outdated and updates shownAt', async () => {
    const dbPath = freshDbPath('outdated');
    const futureVersion = bumpMinor(VERSION);
    const recentlyChecked = Date.now() - 60_000; // not stale → no fetch
    await primeDb(dbPath, {
      latestVersion: futureVersion,
      checkedAt: recentlyChecked,
      shownAt: null,
    });
    // Stub fetch so a stray refresh would be detected.
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const { stream, captured } = fakeStderr(true);
    await maybeRunUpdateCheck({
      dbPath,
      cwd: dbRoot,
      homedir: dbRoot,
      stderr: stream,
      noColorFlag: true,
    });
    const out = captured();
    assert.match(out, /Update available/);
    assert.match(out, new RegExp(`${VERSION} → ${escapeRegex(futureVersion)}`));
    assert.equal(fetchCalled, false, 'cache was not stale → no refresh');
    const persisted = await readCache(dbPath);
    assert.ok(persisted, 'cache row preserved');
    assert.equal(persisted.latestVersion, futureVersion);
    assert.equal(persisted.checkedAt, recentlyChecked, 'checkedAt unchanged');
    assert.ok(typeof persisted.shownAt === 'number', 'shownAt now populated');
  });

  it('does not re-emit the banner inside the 24h cooldown', async () => {
    const dbPath = freshDbPath('cooldown');
    const futureVersion = bumpMinor(VERSION);
    const now = Date.now();
    await primeDb(dbPath, {
      latestVersion: futureVersion,
      checkedAt: now - 60_000,
      shownAt: now - 60_000, // shown 1 min ago
    });
    const { stream, captured } = fakeStderr(true);
    await maybeRunUpdateCheck({
      dbPath,
      cwd: dbRoot,
      homedir: dbRoot,
      stderr: stream,
      noColorFlag: true,
    });
    assert.equal(captured(), '', 'no banner inside the 24h cooldown');
  });

  it('refreshes the cache when stale (>24h) and persists the new latest', async () => {
    const dbPath = freshDbPath('stale-refresh');
    const longAgo = Date.now() - 48 * 60 * 60 * 1000;
    await primeDb(dbPath, {
      latestVersion: VERSION,
      checkedAt: longAgo,
      shownAt: null,
    });
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ version: '99.99.99' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const { stream } = fakeStderr(true);
    await maybeRunUpdateCheck({
      dbPath,
      cwd: dbRoot,
      homedir: dbRoot,
      stderr: stream,
      noColorFlag: true,
    });
    assert.equal(fetchCalled, true, 'stale cache → fetch fired');
    const persisted = await readCache(dbPath);
    assert.ok(persisted);
    assert.equal(persisted.latestVersion, '99.99.99');
  });

  it('swallows fetch failures silently — cache stays as-is', async () => {
    const dbPath = freshDbPath('fetch-fail');
    const longAgo = Date.now() - 48 * 60 * 60 * 1000;
    await primeDb(dbPath, {
      latestVersion: VERSION,
      checkedAt: longAgo,
      shownAt: null,
    });
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const { stream, captured } = fakeStderr(true);
    await maybeRunUpdateCheck({
      dbPath,
      cwd: dbRoot,
      homedir: dbRoot,
      stderr: stream,
      noColorFlag: true,
    });
    // No banner (cache wasn't outdated to begin with) and no throw.
    assert.equal(captured(), '');
    const persisted = await readCache(dbPath);
    assert.ok(persisted);
    assert.equal(persisted.checkedAt, longAgo, 'checkedAt unchanged on fetch failure');
  });
});

// ---------------------------------------------------------------------------
// Storage round-trip robustness — extra shape-failure cases beyond the
// two already covered above (malformed JSON + `{latestVersion: 42}`).
// One sub-case per shape; every read must short-circuit to `null` and
// never throw. Forward-compat guard: when the cache schema evolves the
// loader must keep accepting "looks reasonable" rows and rejecting
// half-populated ones.
// ---------------------------------------------------------------------------

describe('loadUpdateCheckCache shape-failure edges', () => {
  let dbRoot: string;
  let dbCounter = 0;

  function freshDbPath(label: string): string {
    dbCounter += 1;
    return join(dbRoot, `${label}-${dbCounter}.db`);
  }

  before(() => {
    dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-update-check-shapes-'));
  });

  after(() => {
    rmSync(dbRoot, { recursive: true, force: true });
  });

  /**
   * Insert a row with the given JSON payload directly, bypassing the
   * adapter's typed save path. Mirrors the helper inlined into the
   * existing "malformed JSON" / "wrong shape" tests above.
   */
  async function insertRawRow(dbPath: string, valueJson: string): Promise<IUpdateCheckCache | null> {
    const adapter = new SqliteStorageAdapter({
      databasePath: dbPath,
      autoBackup: false,
    });
    await adapter.init();
    try {
      await adapter.db
        .insertInto('config_preferences')
        .values({
          key: UPDATE_CHECK_KEY,
          valueJson,
          updatedAt: Date.now(),
        })
        .execute();
      return await adapter.preferences.loadUpdateCheckCache();
    } finally {
      await adapter.close();
    }
  }

  it('returns null when the JSON parses but the shape is empty (`{}`)', async () => {
    const got = await insertRawRow(freshDbPath('empty-obj'), JSON.stringify({}));
    assert.equal(got, null);
  });

  it('returns null when `latestVersion` is present as a string but `checkedAt` is missing', async () => {
    const got = await insertRawRow(
      freshDbPath('missing-checked-at'),
      JSON.stringify({ latestVersion: '1.0.0' }),
    );
    assert.equal(got, null);
  });

  it('returns null when `value_json` is gibberish (`{not json`)', async () => {
    // Distinct from the existing "{not-json" test above — uses an
    // unambiguous prefix mismatch (no closing brace) to confirm the
    // try/catch around `JSON.parse` swallows arbitrary syntax errors.
    const got = await insertRawRow(freshDbPath('gibberish'), '{not json');
    assert.equal(got, null);
  });
});

// ---------------------------------------------------------------------------
// fetchLatestVersion payload-guard edges
//
// The 404 + missing-`version` paths are already covered above. Here we
// pick up the remaining two failure modes:
//   - non-string `version` (e.g. `42`) — rejects.
//   - mid-fetch TypeError (network reset) — relayed.
// ---------------------------------------------------------------------------

describe('fetchLatestVersion payload guards', () => {
  const ORIGINAL_FETCH = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('rejects when `version` is present but not a string', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await assert.rejects(
      () => fetchLatestVersion('@skill-map/cli', { timeoutMs: 1000 }),
      /missing string `version`/,
    );
  });

  it('relays a mid-fetch TypeError (network reset)', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('network reset');
    }) as typeof fetch;
    await assert.rejects(
      () => fetchLatestVersion('@skill-map/cli', { timeoutMs: 1000 }),
      /network reset/,
    );
  });
});

// ---------------------------------------------------------------------------
// compareVersions — semver §11 edge cases
//
// These guard against stringly-typed regressions (e.g. lexicographic
// numeric ordering — `10` < `2` in string-land) and the prerelease /
// build-metadata corner cases. Every assertion is anchored to the
// semver spec section it codifies.
// ---------------------------------------------------------------------------

describe('compareVersions semver §11 edges', () => {
  it('release > any prerelease at the same triple (§11 rule 3)', () => {
    assert.strictEqual(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
    assert.strictEqual(compareVersions('1.0.0', '1.0.0-rc.1'), 1);
  });

  it('orders numeric prereleases numerically — not lexicographically (§11 rule 4)', () => {
    assert.strictEqual(compareVersions('1.0.0-rc.1', '1.0.0-rc.2'), -1);
    // The killer case: `10` > `2` numerically but `10` < `2`
    // lexicographically. A stringly-typed regression bites here.
    assert.strictEqual(compareVersions('1.0.0-rc.2', '1.0.0-rc.10'), -1);
  });

  it('orders alphabetic prereleases lexicographically (§11 rule 4)', () => {
    assert.strictEqual(compareVersions('1.0.0-beta.5', '1.0.0-rc.1'), -1);
  });

  it('shorter prerelease (with prefix equal) is smaller (§11 rule 4)', () => {
    assert.strictEqual(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  });

  it('numeric < non-numeric at the same prerelease slot (§11 rule 4)', () => {
    assert.strictEqual(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
  });

  it('orders numeric release components numerically — `1.10.0` > `1.9.0`', () => {
    // Stringly-typed regression detector: `'1.10.0' < '1.9.0'`
    // lexicographically, but `1.10.0` is the later release.
    assert.strictEqual(compareVersions('1.10.0', '1.9.0'), 1);
    assert.strictEqual(compareVersions('1.9.0', '1.10.0'), -1);
  });

  it('ignores build metadata (§10) — `1.0.0+build.1` === `1.0.0`', () => {
    assert.strictEqual(compareVersions('1.0.0+build.1', '1.0.0'), 0);
    assert.strictEqual(compareVersions('1.0.0', '1.0.0+build.1'), 0);
  });

  it('orders patch on an all-zero base — `0.0.0` < `0.0.1`', () => {
    assert.strictEqual(compareVersions('0.0.0', '0.0.1'), -1);
    assert.strictEqual(compareVersions('0.0.1', '0.0.0'), 1);
  });
});

// ---------------------------------------------------------------------------
// Clock skew — a future `checkedAt` (system clock jumped backwards on
// this run, or the cache row was written by a host with a clock ahead
// of ours) must NOT cause an unconditional refresh. The freshness check
// is `now - checkedAt > ONE_DAY_MS`; a negative delta is < 24h and the
// cache should be treated as fresh.
// ---------------------------------------------------------------------------

describe('maybeRunUpdateCheck clock-skew guard', () => {
  let dbRoot: string;
  let dbCounter = 0;

  let originalFetch: typeof fetch;

  function freshDbPath(label: string): string {
    dbCounter += 1;
    return join(dbRoot, `${label}-${dbCounter}.db`);
  }

  function fakeStderr(): NodeJS.WriteStream {
    return {
      isTTY: true,
      write(_chunk: string | Uint8Array): boolean {
        return true;
      },
    } as unknown as NodeJS.WriteStream;
  }

  async function primeDb(dbPath: string, seed: IUpdateCheckCache): Promise<void> {
    const adapter = new SqliteStorageAdapter({
      databasePath: dbPath,
      autoBackup: false,
    });
    await adapter.init();
    try {
      await adapter.preferences.saveUpdateCheckCache(seed);
    } finally {
      await adapter.close();
    }
  }

  before(() => {
    dbRoot = mkdtempSync(join(tmpdir(), 'skill-map-update-check-skew-'));
  });

  after(() => {
    rmSync(dbRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not fetch when `checkedAt` is in the future (cache treated as fresh)', async () => {
    const dbPath = freshDbPath('skew');
    // One minute in the future — `now - checkedAt` is negative,
    // therefore < ONE_DAY_MS, so the freshness check must short-circuit
    // the registry probe.
    await primeDb(dbPath, {
      latestVersion: VERSION,
      checkedAt: Date.now() + 60_000,
      shownAt: null,
    });
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ version: '99.99.99' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    await maybeRunUpdateCheck({
      dbPath,
      cwd: dbRoot,
      homedir: dbRoot,
      stderr: fakeStderr(),
      noColorFlag: true,
    });
    assert.equal(fetchCalled, false, 'future checkedAt → cache fresh → no fetch');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Bump the minor of a `M.m.p` triple by 1; used to fabricate "future" versions. */
function bumpMinor(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return '99.99.99';
  const major = match[1];
  const minor = Number.parseInt(match[2] ?? '0', 10);
  const patch = match[3];
  return `${major}.${minor + 1}.${patch}`;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
