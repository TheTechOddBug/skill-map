/**
 * `createLoopbackGate` — DNS rebinding + cross-origin gate for the BFF.
 *
 * Audit H1: closes the lane where a malicious page in the operator's
 * own browser issues fetches at `http://attacker.com:4242/...` after
 * DNS rebinding resolves `attacker.com` to 127.0.0.1, and the
 * related cross-origin / CSRF surface on `/api/*` + `/ws`.
 *
 * The gate matches on hostname only (port-agnostic) since the attacker
 * controls hostname via DNS — port pinning adds no real defence and
 * breaks tests that bind ephemeral ports.
 *
 * Tests use a minimal Hono app with the gate installed; no server
 * boot, no DB. `app.fetch(new Request(...))` exercises the middleware
 * directly via the WHATWG Request/Response shape Hono supports
 * natively.
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { Hono } from 'hono';

import { createLoopbackGate } from '../server/loopback-gate.js';

const PORT = 4242;

function buildApp(): Hono {
  const app = new Hono();
  app.use('*', createLoopbackGate({ port: PORT }));
  // Trivial sinks so requests that pass the gate get a 200.
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/ws', (c) => c.text('ws-ok'));
  app.get('/', (c) => c.text('index'));
  app.get('/index.html', (c) => c.text('index-html'));
  return app;
}

function req(
  path: string,
  headers: Record<string, string>,
): Request {
  return new Request(`http://127.0.0.1:${PORT}${path}`, { headers });
}

describe('createLoopbackGate — Host header', () => {
  it('accepts 127.0.0.1 with the bound port', async () => {
    const app = buildApp();
    const res = await app.fetch(req('/api/health', { host: `127.0.0.1:${PORT}` }));
    strictEqual(res.status, 200);
  });

  it('accepts localhost with the bound port', async () => {
    const app = buildApp();
    const res = await app.fetch(req('/api/health', { host: `localhost:${PORT}` }));
    strictEqual(res.status, 200);
  });

  it('accepts bracketed IPv6 ([::1])', async () => {
    const app = buildApp();
    const res = await app.fetch(req('/api/health', { host: `[::1]:${PORT}` }));
    strictEqual(res.status, 200);
  });

  it('accepts a loopback host on any port (port-agnostic)', async () => {
    // Ephemeral ports under test, or operator-overridden port — both
    // pass as long as the hostname is loopback.
    const app = buildApp();
    const res = await app.fetch(req('/api/health', { host: 'localhost:9999' }));
    strictEqual(res.status, 200);
  });

  it('accepts a port-less loopback host', async () => {
    const app = buildApp();
    const res = await app.fetch(req('/api/health', { host: '127.0.0.1' }));
    strictEqual(res.status, 200);
  });

  it('rejects an attacker hostname pinned to 127.0.0.1 via DNS rebinding', async () => {
    const app = buildApp();
    const res = await app.fetch(req('/api/health', { host: `attacker.example:${PORT}` }));
    strictEqual(res.status, 403);
    const body = await res.json();
    strictEqual((body as { error: string }).error, 'host-not-allowed');
  });

  it('rejects a private-LAN IP host', async () => {
    const app = buildApp();
    const res = await app.fetch(req('/api/health', { host: '192.168.1.10:4242' }));
    strictEqual(res.status, 403);
  });
});

describe('createLoopbackGate — Origin header on /api and /ws', () => {
  it('accepts a matching loopback origin on /api/*', async () => {
    const app = buildApp();
    const res = await app.fetch(
      req('/api/health', {
        host: `127.0.0.1:${PORT}`,
        origin: `http://127.0.0.1:${PORT}`,
      }),
    );
    strictEqual(res.status, 200);
  });

  it('accepts a null origin (sandboxed / file://)', async () => {
    const app = buildApp();
    const res = await app.fetch(
      req('/api/health', {
        host: `127.0.0.1:${PORT}`,
        origin: 'null',
      }),
    );
    strictEqual(res.status, 200);
  });

  it('accepts a Vite-style loopback origin on a different port', async () => {
    const app = buildApp();
    const res = await app.fetch(
      req('/api/health', {
        host: `127.0.0.1:${PORT}`,
        origin: 'http://localhost:5173',
      }),
    );
    strictEqual(res.status, 200);
  });

  it('rejects a cross-origin attacker.com on /api/*', async () => {
    const app = buildApp();
    const res = await app.fetch(
      req('/api/health', {
        host: `127.0.0.1:${PORT}`,
        origin: 'http://attacker.example',
      }),
    );
    strictEqual(res.status, 403);
    const body = await res.json();
    strictEqual((body as { error: string }).error, 'origin-not-allowed');
  });

  it('also enforces Origin on /ws', async () => {
    const app = buildApp();
    const res = await app.fetch(
      req('/ws', {
        host: `127.0.0.1:${PORT}`,
        origin: 'http://attacker.example',
      }),
    );
    strictEqual(res.status, 403);
  });

  it('rejects a non-http(s) origin scheme', async () => {
    const app = buildApp();
    const res = await app.fetch(
      req('/api/health', {
        host: `127.0.0.1:${PORT}`,
        origin: 'file:///etc/passwd',
      }),
    );
    strictEqual(res.status, 403);
  });

  it('rejects a malformed origin (URL parse failure)', async () => {
    const app = buildApp();
    const res = await app.fetch(
      req('/api/health', {
        host: `127.0.0.1:${PORT}`,
        origin: 'not-a-url',
      }),
    );
    strictEqual(res.status, 403);
  });

  it('does NOT enforce Origin on static routes', async () => {
    // Browser navigation to a static asset omits Origin; even if an
    // attacker forces one, the Host gate already covered DNS rebinding
    // and the response is the public bundle.
    const app = buildApp();
    const res = await app.fetch(
      req('/index.html', {
        host: `127.0.0.1:${PORT}`,
        origin: 'http://attacker.example',
      }),
    );
    strictEqual(res.status, 200);
  });
});
