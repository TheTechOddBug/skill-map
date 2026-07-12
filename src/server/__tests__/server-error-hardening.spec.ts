/**
 * BFF error-handling hardening, audit follow-ups L3 + L4.
 *
 *   - L3, `formatError`'s unmapped-throw fall-through redacts the
 *     human-readable `error.message` to a generic constant (the raw
 *     `err.message` carries kernel detail, absolute paths, registry
 *     hostnames, etc.). The real detail is routed to `log.warn` so
 *     operators still see it on stderr / their log file.
 *   - L4, the 404 envelope templates (`unknownApiEndpoint` for
 *     `/api/*` catch-all; `unknownPath` for the SPA fallback) sanitise
 *     `c.req.path` with `sanitizeForTerminal` before interpolation, so
 *     attacker-controlled ANSI / C0 bytes (CR/LF, ESC, BEL) cannot flow
 *     into the JSON envelope or the BFF's stderr log line.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { strictEqual, ok, match, doesNotMatch } from 'node:assert';

import { Hono } from 'hono';

import {
  formatError,
  type IErrorEnvelope,
} from '../app.js';
import { DbSchemaDriftError } from '../../core/sqlite/db-version-check.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import {
  configureLogger,
  resetLogger,
} from '../../kernel/util/logger.js';
import type { LoggerPort } from '../../kernel/ports/logger.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../index.js';

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-server-error-hardening-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

interface ICapturedWarn {
  message: string;
  context?: Record<string, unknown>;
}

function captureWarnLogger(buffer: ICapturedWarn[]): LoggerPort {
  return {
    trace() {},
    debug() {},
    info() {},
    warn(message, context) {
      buffer.push({ message, ...(context !== undefined ? { context } : {}) });
    },
    error() {},
  };
}

describe('audit L3, internal-error envelope redacts err.message and logs detail', () => {
  it('non-HTTPException fall-through, envelope.message is the generic constant', async () => {
    const warnings: ICapturedWarn[] = [];
    configureLogger(captureWarnLogger(warnings));
    try {
      const app = new Hono();
      app.get('/boom', () => {
        // Plain Error with disk path-like detail, simulates a kernel
        // throw that leaks `/home/<user>/...` or a registry hostname.
        throw new Error('internal: /home/alice/secrets/registry-host.example/x.db');
      });
      app.onError((err, c) => formatError(err, c));

      const res = await app.fetch(new Request('http://127.0.0.1/boom'));
      strictEqual(res.status, 500);
      const body = (await res.json()) as IErrorEnvelope;

      strictEqual(body.ok, false);
      strictEqual(body.error.code, 'internal');
      strictEqual(body.error.message, SERVER_TEXTS.internalError);
      strictEqual(body.error.details, null);

      // The leaked detail must NOT appear in the response body.
      const bodyText = JSON.stringify(body);
      doesNotMatch(bodyText, /\/home\/alice/);
      doesNotMatch(bodyText, /secrets/);
      doesNotMatch(bodyText, /registry-host\.example/);
    } finally {
      resetLogger();
    }
  });

  it('non-HTTPException fall-through, real detail flows through log.warn', async () => {
    const warnings: ICapturedWarn[] = [];
    configureLogger(captureWarnLogger(warnings));
    try {
      const app = new Hono();
      app.get('/boom', () => {
        throw new Error('verbatim-kernel-message: /etc/skill-map/foo');
      });
      app.onError((err, c) => formatError(err, c));

      await app.fetch(new Request('http://127.0.0.1/boom'));

      ok(warnings.length >= 1, 'expected at least one log.warn call');
      const w = warnings[0]!;
      ok(
        w.message.includes('verbatim-kernel-message: /etc/skill-map/foo'),
        `expected real detail in log.warn message, got: ${w.message}`,
      );
      // Stack travels as context.stack when present (every native Error
      // carries one).
      const ctx = w.context;
      ok(ctx !== undefined, 'expected log.warn to receive context');
      ok(
        typeof ctx['stack'] === 'string',
        'expected log.warn context.stack to be a string',
      );
    } finally {
      resetLogger();
    }
  });

  it('custom Error subclass without a mapped handler, fall-through still redacts + logs', async () => {
    // Some kernel errors are plain `Error` subclasses (e.g. a future
    // helper that throws `TypeError` from a buggy code path). They
    // travel through the fall-through unchanged; the redaction applies
    // regardless of subclass.
    const warnings: ICapturedWarn[] = [];
    configureLogger(captureWarnLogger(warnings));
    try {
      const app = new Hono();
      app.get('/boom-type', () => {
        throw new TypeError('cannot read property "x" of /home/bob/.skill-map/secret');
      });
      app.onError((err, c) => formatError(err, c));

      const res = await app.fetch(new Request('http://127.0.0.1/boom-type'));
      const body = (await res.json()) as IErrorEnvelope;
      strictEqual(body.error.code, 'internal');
      strictEqual(body.error.message, SERVER_TEXTS.internalError);

      ok(warnings.length >= 1);
      ok(warnings[0]!.message.includes('/home/bob/.skill-map/secret'));
    } finally {
      resetLogger();
    }
  });

  it('DbSchemaDriftError maps to a clean db-drift 500 (not the redacted internal fall-through)', async () => {
    // A mutating `/api/*` request against a drifted DB throws
    // `DbSchemaDriftError` from the write-side `withSqlite` guard. It must
    // surface as a clean `db-drift` envelope carrying the plain advisory,
    // NOT the redacted `internal` 500 that the generic fall-through emits.
    const app = new Hono();
    app.get('/boom', () => {
      throw new DbSchemaDriftError({
        message: 'This DB predates a schema change. Run `sm db reset --hard` then `sm scan`.',
        humanMessage: '✕  schema change\n   hint\n',
      });
    });
    app.onError((err, c) => formatError(err, c));

    const res = await app.fetch(new Request('http://127.0.0.1/boom'));
    strictEqual(res.status, 500);
    const body = (await res.json()) as IErrorEnvelope;
    strictEqual(body.ok, false);
    strictEqual(body.error.code, 'db-drift');
    strictEqual(body.error.details, null);
    // The plain advisory (not the §3.1b glyph block) rides the envelope.
    ok(body.error.message.includes('sm db reset --hard'));
    ok(body.error.message.includes('sm scan'));
    match(body.error.message, /schema change/);
  });

  it('does NOT redact HTTPException-derived envelopes', async () => {
    // L3 only redacts the fall-through. Mapped throws (HTTPException,
    // ExportQueryError, etc.) keep carrying their own message because
    // those are authored by the BFF itself and live in `server.texts.ts`.
    const warnings: ICapturedWarn[] = [];
    configureLogger(captureWarnLogger(warnings));
    try {
      const { HTTPException } = await import('hono/http-exception');
      const app = new Hono();
      app.get('/bad', () => {
        throw new HTTPException(400, { message: 'authored bad-query message' });
      });
      app.onError((err, c) => formatError(err, c));

      const res = await app.fetch(new Request('http://127.0.0.1/bad'));
      strictEqual(res.status, 400);
      const body = (await res.json()) as IErrorEnvelope;
      strictEqual(body.error.code, 'bad-query');
      strictEqual(body.error.message, 'authored bad-query message');

      // No fall-through log.warn for mapped throws.
      strictEqual(warnings.length, 0);
    } finally {
      resetLogger();
    }
  });
});

// ---- L4, 404 path sanitization ---------------------------------------------

function defaultOptions(overrides: Partial<IServerOptions> = {}): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: join(tmpRoot, 'never-existed.db'),
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
    mcpServer: false,
    ...overrides,
  };
}

async function bootAndUse<T>(
  options: IServerOptions,
  fn: (handle: IServerHandle) => Promise<T>,
): Promise<T> {
  const handle = await createServer(options);
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

// Regexes that look for raw bytes the sanitiser must strip. Spelled with
// hex escapes / character classes so the source stays printable ASCII.
// eslint-disable-next-line no-control-regex
const ESC_BYTE_RE = /\x1B/;
// C0 control subset that `sanitizeForTerminal` strips, NUL through
// US plus DEL, excluding TAB / LF / CR (which the sanitiser keeps for
// readability). Asserting absence covers BEL / NUL / VT / FF / SO / SI
// / DLE / etc.
// eslint-disable-next-line no-control-regex
const C0_BYTE_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

describe('audit L4, 404 envelope sanitises c.req.path', () => {
  it('/api/* catch-all strips ANSI CSI from path', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // Percent-encode the ESC byte so it survives Node's outbound URL
      // parser. Hono URL-decodes `c.req.path` back to the raw bytes;
      // the sanitiser then strips them.
      const path = '/api/never%1B%5B31mred%1B%5B0m';
      const res = await fetch(url(handle, path));
      strictEqual(res.status, 404);
      const body = (await res.json()) as IErrorEnvelope;
      strictEqual(body.error.code, 'not-found');
      // No raw ESC bytes in the response message.
      doesNotMatch(body.error.message, ESC_BYTE_RE);
      // Adjacent ASCII letters survive (sanitisation strips the CSI
      // tail, not surrounding printables).
      match(body.error.message, /never/);
      match(body.error.message, /red/);
    });
  });

  it('/api/* catch-all strips C0 controls (BEL, NUL) from path', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // BEL (0x07) and NUL (0x00), each percent-encoded.
      const path = '/api/inject%07%00trail';
      const res = await fetch(url(handle, path));
      strictEqual(res.status, 404);
      const body = (await res.json()) as IErrorEnvelope;
      strictEqual(body.error.code, 'not-found');
      doesNotMatch(body.error.message, C0_BYTE_RE);
      match(body.error.message, /injecttrail/);
    });
  });

  it('cursor-move CSI (ESC [ H) is stripped from /api/* path', async () => {
    await bootAndUse(defaultOptions(), async (handle) => {
      // ESC [ H = cursor home, a classic ANSI hijack sequence.
      const path = '/api/x%1B%5BHmoved-cursor';
      const res = await fetch(url(handle, path));
      strictEqual(res.status, 404);
      const body = (await res.json()) as IErrorEnvelope;
      doesNotMatch(body.error.message, ESC_BYTE_RE);
      match(body.error.message, /moved-cursor/);
    });
  });
});
