/**
 * `createSecurityHeaders`, baseline response-header policy enforced on
 * every BFF response (audit `app-hacker` L2).
 *
 * The middleware is the SPA's clickjacking / MIME-sniff / referrer-leak
 * line of defence. Tests use a minimal Hono app, no full `createApp`
 * boot, so they pin the contract independently of route deps.
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { Hono } from 'hono';

import { createSecurityHeaders, DEFAULT_CSP } from '../security-headers.js';

function buildApp(): Hono {
  const app = new Hono();
  app.use('*', createSecurityHeaders());
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/', (c) => c.text('index'));
  return app;
}

describe('createSecurityHeaders, baseline headers', () => {
  it('sets Content-Security-Policy with frame-ancestors none + base-uri self + form-action self', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('http://127.0.0.1/api/health'));
    strictEqual(res.status, 200);
    strictEqual(res.headers.get('content-security-policy'), DEFAULT_CSP);
  });

  it("CSP carries object-src 'none' (plugin-content backstop if DOMPurify regresses)", async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('http://127.0.0.1/api/health'));
    const csp = res.headers.get('content-security-policy') ?? '';
    strictEqual(csp.includes("object-src 'none'"), true);
  });

  it('sets X-Frame-Options DENY', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('http://127.0.0.1/api/health'));
    strictEqual(res.headers.get('x-frame-options'), 'DENY');
  });

  it('sets X-Content-Type-Options nosniff', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('http://127.0.0.1/api/health'));
    strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  });

  it('sets Referrer-Policy no-referrer', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('http://127.0.0.1/api/health'));
    strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
  });

  it('stamps headers on non-API routes too (e.g. SPA index)', async () => {
    const app = buildApp();
    const res = await app.fetch(new Request('http://127.0.0.1/'));
    strictEqual(res.status, 200);
    strictEqual(res.headers.get('content-security-policy'), DEFAULT_CSP);
    strictEqual(res.headers.get('x-frame-options'), 'DENY');
  });
});

describe('createSecurityHeaders, override discipline', () => {
  it('does not overwrite a CSP set by a downstream route', async () => {
    const app = new Hono();
    app.use('*', createSecurityHeaders());
    app.get('/api/custom', (c) => {
      c.header('content-security-policy', 'frame-ancestors *');
      return c.json({ ok: true });
    });
    const res = await app.fetch(new Request('http://127.0.0.1/api/custom'));
    strictEqual(res.headers.get('content-security-policy'), 'frame-ancestors *');
  });

  it('does not overwrite an X-Frame-Options set by a downstream route', async () => {
    const app = new Hono();
    app.use('*', createSecurityHeaders());
    app.get('/api/custom', (c) => {
      c.header('x-frame-options', 'SAMEORIGIN');
      return c.json({ ok: true });
    });
    const res = await app.fetch(new Request('http://127.0.0.1/api/custom'));
    strictEqual(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  });

  it('stamps headers even when the route throws (envelope still secure)', async () => {
    const app = new Hono();
    app.use('*', createSecurityHeaders());
    app.get('/api/boom', () => {
      throw new Error('boom');
    });
    app.onError((_err, c) => c.json({ ok: false, error: 'boom' }, 500));
    const res = await app.fetch(new Request('http://127.0.0.1/api/boom'));
    strictEqual(res.status, 500);
    strictEqual(res.headers.get('content-security-policy'), DEFAULT_CSP);
    strictEqual(res.headers.get('x-frame-options'), 'DENY');
  });
});
