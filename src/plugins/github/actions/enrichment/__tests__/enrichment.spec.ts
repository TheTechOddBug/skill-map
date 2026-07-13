/**
 * Unit tests for the built-in `github/enrichment` Action (Model A
 * provenance verification) with a fake `ctx.fetch` transport, no real
 * network ever.
 *
 * Covers:
 *   - raw-sha pin, matching body → verified true, no API round-trip.
 *   - raw-sha pin, drifted body → verified false with both hashes.
 *   - frontmatter-only remote difference → STILL verified true (the
 *     remote is hashed through the same fence splitter as the local
 *     body, see the action header).
 *   - api-ref resolution happy path, incl. Authorization header present
 *     exactly when the `token` setting is configured.
 *   - remote failures (throwing fetch, non-OK raw status, rate limit)
 *     → `verified: false` reports with a `detail`, never a throw.
 *   - unparseable `source` → `verified: false` + detail, no fetch call.
 *   - `parseGithubSource` URL-form matrix (blob / bare / raw host).
 *   - missing `ctx.fetch` → programmer-error throw.
 */

import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { enrichmentAction, parseGithubSource, type IGithubEnrichmentReport } from '../index.js';
import type { IActionContext } from '../../../../../kernel/extensions/index.js';
import { sha256 } from '../../../../../kernel/orchestrator/node-build.js';
import type { Node } from '../../../../../kernel/types.js';

const LOCAL_BODY = 'Body of the agent.\n';
const LOCAL_BODY_HASH = sha256(LOCAL_BODY);
const SHA_PIN = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const BLOB_SOURCE = `https://github.com/octo/tools/blob/main/agents/architect.md`;

interface IFetchCall {
  url: string;
  headers: Record<string, string>;
}

/** Fake transport: records calls, delegates to a per-URL handler. */
function fakeFetch(
  handler: (url: string) => Response | Promise<Response>,
  calls: IFetchCall[] = [],
): typeof globalThis.fetch {
  return ((input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers ?? {} });
    return Promise.resolve(handler(url));
  }) as typeof globalThis.fetch;
}

function makeNode(annotations: Record<string, unknown> | null): Node {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    provider: 'claude',
    bodyHash: LOCAL_BODY_HASH,
    frontmatterHash: 'f'.repeat(64),
    bytes: { frontmatter: 0, body: LOCAL_BODY.length, total: LOCAL_BODY.length },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    sidecar: { present: annotations !== null, status: 'fresh', annotations },
  };
}

function makeCtx(
  node: Node,
  fetchImpl: typeof globalThis.fetch | undefined,
  settings: Record<string, unknown> = {},
): IActionContext {
  const ctx: IActionContext = {
    node,
    nodeAbsolutePath: `/repo/${node.path}`,
    invoker: 'cli',
    now: () => new Date('2026-07-13T12:00:00.000Z'),
    settings,
  };
  if (fetchImpl) ctx.fetch = fetchImpl;
  return ctx;
}

async function invoke(ctx: IActionContext): Promise<IGithubEnrichmentReport> {
  const result = await enrichmentAction.invoke!<Record<string, never>, IGithubEnrichmentReport>(
    {},
    ctx,
  );
  return result.report;
}

describe('github/enrichment, raw-sha pin', () => {
  it('verifies true when the remote body matches, without any API round-trip', async () => {
    const calls: IFetchCall[] = [];
    const node = makeNode({ source: BLOB_SOURCE, sourceVersion: SHA_PIN });
    const ctx = makeCtx(node, fakeFetch(() => new Response(LOCAL_BODY), calls));

    const report = await invoke(ctx);
    strictEqual(report.verified, true);
    strictEqual(report.method, 'raw-sha');
    strictEqual(report.resolvedSha, null, 'the pin IS the SHA, nothing resolved');
    strictEqual(report.localBodyHash, LOCAL_BODY_HASH);
    strictEqual(report.remoteBodyHash, LOCAL_BODY_HASH);
    strictEqual(report.detail, undefined, 'clean verification carries no detail');
    strictEqual(
      report.sourceUrl,
      `https://raw.githubusercontent.com/octo/tools/${SHA_PIN}/agents/architect.md`,
    );
    deepStrictEqual(
      calls.map((c) => c.url),
      [report.sourceUrl],
      'exactly one fetch, straight at the immutable raw URL',
    );
  });

  it('verifies false with both hashes on a body mismatch', async () => {
    const node = makeNode({ source: BLOB_SOURCE, sourceVersion: SHA_PIN });
    const ctx = makeCtx(node, fakeFetch(() => new Response('Different upstream body.\n')));

    const report = await invoke(ctx);
    strictEqual(report.verified, false);
    strictEqual(report.localBodyHash, LOCAL_BODY_HASH);
    strictEqual(report.remoteBodyHash, sha256('Different upstream body.\n'));
    ok(report.detail, 'mismatch names itself in detail');
  });

  it('still verifies true when the remote differs ONLY in frontmatter', async () => {
    const node = makeNode({ source: BLOB_SOURCE, sourceVersion: SHA_PIN });
    const remote = `---\nname: upstream-only-metadata\nextra: field\n---\n${LOCAL_BODY}`;
    const ctx = makeCtx(node, fakeFetch(() => new Response(remote)));

    const report = await invoke(ctx);
    strictEqual(report.verified, true, 'frontmatter-only drift must not flip the verdict');
    strictEqual(report.remoteBodyHash, LOCAL_BODY_HASH);
  });
});

describe('github/enrichment, api-ref resolution', () => {
  const RESOLVED = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00';

  function apiThenRaw(calls: IFetchCall[]): typeof globalThis.fetch {
    return fakeFetch((url) => {
      if (url.startsWith('https://api.github.com/')) {
        return new Response(JSON.stringify({ sha: RESOLVED }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(LOCAL_BODY);
    }, calls);
  }

  it('resolves the ref via the API, records resolvedSha, then raw-fetches at that SHA', async () => {
    const calls: IFetchCall[] = [];
    const node = makeNode({ source: BLOB_SOURCE, sourceVersion: 'v1.2.3' });
    const ctx = makeCtx(node, apiThenRaw(calls));

    const report = await invoke(ctx);
    strictEqual(report.verified, true);
    strictEqual(report.method, 'api-ref');
    strictEqual(report.resolvedSha, RESOLVED);
    deepStrictEqual(
      calls.map((c) => c.url),
      [
        'https://api.github.com/repos/octo/tools/commits/v1.2.3',
        `https://raw.githubusercontent.com/octo/tools/${RESOLVED}/agents/architect.md`,
      ],
    );
    strictEqual(
      calls[0]!.headers['authorization'],
      undefined,
      'no Authorization header without a configured token',
    );
  });

  it('sends Authorization: Bearer <token> on the API call when the token setting is present', async () => {
    const calls: IFetchCall[] = [];
    const node = makeNode({ source: BLOB_SOURCE, sourceVersion: 'main' });
    const ctx = makeCtx(node, apiThenRaw(calls), { token: 'ghp_secret' });

    await invoke(ctx);
    strictEqual(calls[0]!.headers['authorization'], 'Bearer ghp_secret');
    strictEqual(
      calls[1]!.headers['authorization'],
      undefined,
      'the raw fetch stays unauthenticated',
    );
  });

  it('reports the rate-limit case with a directed detail (403 + x-ratelimit-remaining: 0)', async () => {
    const node = makeNode({ source: BLOB_SOURCE, sourceVersion: 'main' });
    const ctx = makeCtx(
      node,
      fakeFetch(
        () =>
          new Response('rate limited', {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0' },
          }),
      ),
    );

    const report = await invoke(ctx);
    strictEqual(report.verified, false);
    strictEqual(report.remoteBodyHash, null);
    match(report.detail ?? '', /rate limit/i);
    match(report.detail ?? '', /token/, 'points the operator at the token setting');
  });

  it('reports a plain non-OK ref resolution without the rate-limit framing', async () => {
    const node = makeNode({ source: BLOB_SOURCE, sourceVersion: 'gone-branch' });
    const ctx = makeCtx(node, fakeFetch(() => new Response('nope', { status: 404 })));

    const report = await invoke(ctx);
    strictEqual(report.verified, false);
    match(report.detail ?? '', /404/);
  });
});

describe('github/enrichment, remote failures never throw', () => {
  it('a throwing fetch lands as verified false + detail (network error)', async () => {
    const node = makeNode({ source: BLOB_SOURCE, sourceVersion: SHA_PIN });
    const ctx = makeCtx(
      node,
      fakeFetch(() => {
        throw new Error('getaddrinfo ENOTFOUND raw.githubusercontent.com');
      }),
    );

    const report = await invoke(ctx);
    strictEqual(report.verified, false);
    strictEqual(report.remoteBodyHash, null);
    match(report.detail ?? '', /ENOTFOUND/);
  });

  it('a non-OK raw fetch lands as verified false + detail naming the status', async () => {
    const node = makeNode({ source: BLOB_SOURCE, sourceVersion: SHA_PIN });
    const ctx = makeCtx(node, fakeFetch(() => new Response('gone', { status: 404 })));

    const report = await invoke(ctx);
    strictEqual(report.verified, false);
    strictEqual(report.remoteBodyHash, null);
    match(report.detail ?? '', /404/);
  });
});

describe('github/enrichment, source parsing', () => {
  it('an unparseable source reports verified false + detail without fetching', async () => {
    const calls: IFetchCall[] = [];
    const node = makeNode({ source: 'https://example.com/not/github.md', sourceVersion: SHA_PIN });
    const ctx = makeCtx(node, fakeFetch(() => new Response(LOCAL_BODY), calls));

    const report = await invoke(ctx);
    strictEqual(report.verified, false);
    match(report.detail ?? '', /Could not parse/);
    strictEqual(calls.length, 0, 'nothing fetched for an unparseable source');
  });

  it('parseGithubSource accepts the documented URL forms and rejects the rest', () => {
    const expected = { owner: 'octo', repo: 'tools', path: 'agents/architect.md' };
    deepStrictEqual(
      parseGithubSource('https://github.com/octo/tools/blob/main/agents/architect.md'),
      expected,
    );
    deepStrictEqual(
      parseGithubSource('github.com/octo/tools/agents/architect.md'),
      expected,
      'scheme-less, blob-less shorthand',
    );
    deepStrictEqual(
      parseGithubSource('www.github.com/octo/tools/blob/v2/agents/architect.md#L10'),
      expected,
      'www + line-anchor fragment tolerated',
    );
    deepStrictEqual(
      parseGithubSource('https://raw.githubusercontent.com/octo/tools/main/agents/architect.md'),
      expected,
      'the raw-URL form the annotations catalog cites',
    );
    strictEqual(parseGithubSource('https://github.com/octo/tools'), null, 'no file path');
    strictEqual(parseGithubSource('https://github.com/octo/tools/blob/main'), null, 'blob without a path');
    strictEqual(parseGithubSource('https://gitlab.com/octo/tools/x.md'), null, 'foreign host');
  });
});

describe('github/enrichment, contract guards', () => {
  it('throws when invoked without ctx.fetch (programmer error, not a report)', async () => {
    const node = makeNode({ source: BLOB_SOURCE, sourceVersion: SHA_PIN });
    await rejects(() => invoke(makeCtx(node, undefined)), /ctx\.fetch/);
  });

  it('missing annotations degrade to a verified-false report (defensive path)', async () => {
    const calls: IFetchCall[] = [];
    const node = makeNode(null);
    const ctx = makeCtx(node, fakeFetch(() => new Response(LOCAL_BODY), calls));

    const report = await invoke(ctx);
    strictEqual(report.verified, false);
    match(report.detail ?? '', /annotations/);
    strictEqual(calls.length, 0);
  });
});
