/**
 * Static-handler placeholder tests, covers the dual-placeholder branch
 * introduced with `--no-ui`:
 *
 *   - `uiDist: null, noUi: false` → "UI bundle was not found" copy
 *     (the long-standing accidental-missing-bundle hint).
 *   - `uiDist: null, noUi: true`  → "BFF in dev mode, UI disabled"
 *     copy (intentional opt-out, points the operator at `npm run ui:dev`).
 *
 * The handlers are exercised in isolation against a stand-alone Hono
 * instance, no listener bind, no cross-cutting boot. That keeps the
 * test snappy and focused on the placeholder dispatch.
 *
 * Table-driven: each case names the option bag, the request path, and
 * the substrings that MUST and MUST NOT appear in the response body.
 * Adding a new placeholder branch becomes a one-row append.
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

import { createSpaFallback, createStaticHandler, injectServeMetas } from '../static.js';

interface IPlaceholderCase {
  name: string;
  opts: { uiDist: string | null; noUi: boolean };
  path: string;
  expectMatch: RegExp[];
  expectNoMatch: RegExp[];
}

const CASES: IPlaceholderCase[] = [
  {
    name: 'serves the dev-mode placeholder at "/" when uiDist is null and noUi is true',
    opts: { uiDist: null, noUi: true },
    path: '/',
    expectMatch: [/dev mode \(UI disabled\)/, /npm run ui:dev/],
    expectNoMatch: [/UI bundle was not found/],
  },
  {
    name: 'serves the dev-mode placeholder for SPA deep links when noUi is true',
    opts: { uiDist: null, noUi: true },
    path: '/inspector/foo.md',
    expectMatch: [/dev mode \(UI disabled\)/],
    expectNoMatch: [/UI bundle was not found/],
  },
  {
    name: 'serves the accidental-missing-bundle placeholder when uiDist is null and noUi is false',
    opts: { uiDist: null, noUi: false },
    path: '/',
    expectMatch: [/UI bundle was not found/, /skill-map server is running/],
    expectNoMatch: [/dev mode \(UI disabled\)/],
  },
];

function mountStatic(opts: {
  uiDist: string | null;
  noUi: boolean;
  scopeRoot?: string | null;
  cliVersion?: string | null;
}): Hono {
  const app = new Hono();
  app.use('*', createStaticHandler(opts));
  app.get('*', createSpaFallback(opts));
  return app;
}

describe('static handler, placeholder dispatch', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const app = mountStatic(c.opts);
      const res = await app.request(c.path);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/html/);
      const body = await res.text();
      for (const re of c.expectMatch) assert.match(body, re);
      for (const re of c.expectNoMatch) assert.doesNotMatch(body, re);
    });
  }
});


/**
 * The scope-meta stamp (spec cli-contract.md §Serve): the served
 * `index.html` carries the resolved scope root so the SPA can
 * namespace its browser-local project state per project.
 */
describe('static handler, scope-meta stamp', () => {
  let uiDist: string;

  before(() => {
    uiDist = mkdtempSync(join(tmpdir(), 'skill-map-static-scope-'));
    writeFileSync(
      join(uiDist, 'index.html'),
      '<!doctype html><html><head><title>x</title></head><body></body></html>',
      'utf8',
    );
    writeFileSync(join(uiDist, 'main.js'), 'console.log(1)', 'utf8');
  });

  after(() => {
    rmSync(uiDist, { recursive: true, force: true });
  });

  it('stamps "/", "/index.html" and SPA deep links; assets stream untouched', async () => {
    const app = mountStatic({
      uiDist,
      noUi: false,
      scopeRoot: '/home/x/proj',
      cliVersion: '1.12.0',
    });
    for (const path of ['/', '/index.html', '/some/deep/link']) {
      const body = await (await app.request(path)).text();
      assert.match(body, /<meta name="skill-map-scope" content="\/home\/x\/proj">/, path);
      assert.match(body, /<meta name="skill-map-version" content="1\.12\.0">/, path);
    }
    const asset = await (await app.request('/main.js')).text();
    assert.equal(asset.includes('skill-map-scope'), false);
  });

  it('no scopeRoot = no stamp, the document serves verbatim', async () => {
    const app = mountStatic({ uiDist, noUi: false });
    const body = await (await app.request('/')).text();
    assert.equal(body.includes('skill-map-scope'), false);
  });

  it('injectServeMetas escapes attribute-hostile values and skips head-less documents', () => {
    const stamped = injectServeMetas('<head></head>', { scopeRoot: '/a"b&c', cliVersion: null });
    assert.match(stamped, /content="\/a&quot;b&amp;c"/);
    assert.equal(stamped.includes('skill-map-version'), false);
    const headless = '<html><body>plain</body></html>';
    assert.equal(
      injectServeMetas(headless, { scopeRoot: '/x', cliVersion: '1.0.0' }),
      headless,
    );
  });
});
