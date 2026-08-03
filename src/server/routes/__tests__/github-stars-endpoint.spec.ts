/**
 * `GET /api/github-stars` (`spec/cli-contract.md` §`GET /api/github-stars`).
 *
 * The contract worth pinning is the DEGRADED path, because it is the one
 * that runs on a laptop with no network: every failure mode collapses to
 * `count: null`, which the UI renders as nothing. A star counter that
 * answered `0`, or 500, or hung, would make a healthy offline install
 * look broken.
 *
 * Also pinned: the memory cache (one upstream request per window, shared
 * by concurrent callers) and the toggle short-circuit (opted out means NO
 * request, not a hidden result). `fetch` is stubbed throughout, so no
 * test here touches the network.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { registerGithubStarsRoute, resetGithubStarsCache } from '../github-stars.js';

interface IStarsBody {
  count: number | null;
  checkedAt: number | null;
}

/** Minimal Hono stand-in: captures the handler the route registers. */
function mountRoute(): () => Promise<IStarsBody> {
  let handler: ((c: unknown) => Promise<{ body: IStarsBody }>) | null = null;
  const app = {
    get(path: string, fn: (c: unknown) => Promise<{ body: IStarsBody }>) {
      assert.equal(path, '/api/github-stars');
      handler = fn;
    },
  };
  registerGithubStarsRoute(app as never);
  assert.ok(handler, 'route did not register');
  const ctx = { json: (body: IStarsBody) => ({ body }) };
  return async () => (await handler!(ctx)).body;
}

/** Stub `fetch` with a fixed outcome; returns the call counter. */
function stubFetch(outcome: 'ok' | 'rate-limited' | 'offline' | 'garbage', count = 27): {
  calls: () => number;
} {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    if (outcome === 'offline') throw new Error('getaddrinfo ENOTFOUND api.github.com');
    if (outcome === 'rate-limited') {
      return { ok: false, status: 403, json: async () => ({}) } as unknown as Response;
    }
    if (outcome === 'garbage') {
      return { ok: true, status: 200, json: async () => ({ message: 'Moved' }) } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ stargazers_count: count }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  restoreFetch = () => {
    globalThis.fetch = original;
  };
  return { calls: () => calls };
}

let restoreFetch: (() => void) | null = null;

let realHome: string | undefined;

/**
 * Point `os.homedir()` at a throwaway directory holding `settings`
 * (POSIX `homedir()` honours $HOME). Without this the spec would read
 * the developer's own `~/.skill-map/settings.json`, so a maintainer who
 * turned the counter off would see these tests behave differently from
 * CI, the same isolation the CLI spawn-specs already do for telemetry.
 */
function withUserSettings(settings: unknown): void {
  const home = mkdtempSync(join(tmpdir(), 'sm-stars-home-'));
  mkdirSync(join(home, '.skill-map'), { recursive: true });
  writeFileSync(
    join(home, '.skill-map', 'settings.json'),
    JSON.stringify({ schemaVersion: 1, ...(settings as object) }),
  );
  process.env['HOME'] = home;
}

beforeEach(() => {
  resetGithubStarsCache();
  realHome = process.env['HOME'];
  // Default for every test: an empty home, i.e. the toggle is absent,
  // which the store reads as enabled.
  withUserSettings({});
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  if (realHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = realHome;
  resetGithubStarsCache();
  mock.restoreAll();
});

describe('GET /api/github-stars', () => {
  it('reports the count from the upstream payload', async () => {
    stubFetch('ok', 27);
    const call = mountRoute();

    const body = await call();

    assert.equal(body.count, 27);
    assert.equal(typeof body.checkedAt, 'number');
  });

  it('answers null when the machine is offline', async () => {
    stubFetch('offline');
    const call = mountRoute();

    const body = await call();

    // Not a 500, not a zero: unknown, which renders nothing.
    assert.deepEqual(body, { count: null, checkedAt: null });
  });

  it('answers null when GitHub rate-limits the IP', async () => {
    stubFetch('rate-limited');
    const call = mountRoute();

    assert.deepEqual(await call(), { count: null, checkedAt: null });
  });

  it('answers null when the payload carries no numeric count', async () => {
    stubFetch('garbage');
    const call = mountRoute();

    assert.deepEqual(await call(), { count: null, checkedAt: null });
  });

  it('serves repeat reads from memory: one upstream request per window', async () => {
    const { calls } = stubFetch('ok', 27);
    const call = mountRoute();

    await call();
    await call();
    await call();

    assert.equal(calls(), 1);
  });

  it('collapses concurrent reads onto a single upstream request', async () => {
    const { calls } = stubFetch('ok', 27);
    const call = mountRoute();

    const bodies = await Promise.all([call(), call(), call()]);

    assert.equal(calls(), 1);
    for (const body of bodies) assert.equal(body.count, 27);
  });

  it('caches the failure too, so an outage cannot become a request storm', async () => {
    const { calls } = stubFetch('offline');
    const call = mountRoute();

    await call();
    await call();

    assert.equal(calls(), 1);
  });

  it('opted out means NO request at all, not a hidden result', async () => {
    // The toggle's promise is about the network, not the pixels: a
    // request that happens and is then discarded would still spend the
    // operator's IP budget and still tell GitHub they are running this.
    withUserSettings({ githubStars: { enabled: false } });
    const { calls } = stubFetch('ok', 27);
    const call = mountRoute();

    assert.deepEqual(await call(), { count: null, checkedAt: null });
    assert.equal(calls(), 0);
  });
});
