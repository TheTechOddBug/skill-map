/**
 * Tests for the BFF telemetry capture policy (`server/telemetry/sentry.ts`):
 * the pure `shouldCaptureError` decision, plus the request-capture middleware
 * exercised against an injected fake `@sentry/node` (spy), so the capture +
 * tagging path is asserted without standing up the SDK or touching the
 * network. Consent is controlled through a redirected HOME tempdir.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import type { Context, Next } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import {
  createSentryRequestCapture,
  initSentryBff,
  resetBffTelemetryForTests,
  shouldCaptureError,
} from '../sentry.js';

let homeRoot: string;
let originalHome: string | undefined;
let originalUserprofile: string | undefined;
let originalKill: string | undefined;

/** A spy stand-in for `@sentry/node` plus a loader to feed `initSentryBff`. */
function makeFakeSentry() {
  const setTag = mock.fn();
  const captureException = mock.fn();
  const withScope = mock.fn((cb: (scope: { setTag: typeof setTag }) => void) => {
    cb({ setTag });
  });
  return { init: mock.fn(), withScope, captureException, setTag };
}

function loaderFor(fake: ReturnType<typeof makeFakeSentry>): () => Promise<typeof import('@sentry/node')> {
  return () => Promise.resolve(fake as unknown as typeof import('@sentry/node'));
}

function optIn(): void {
  const dir = join(homeRoot, '.skill-map');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ schemaVersion: 1, telemetry: { errorsEnabled: true } }),
  );
}

/** A minimal Hono context the middleware reads (`req.method` / `routePath`). */
function fakeContext(method: string, route: string): Context {
  return { req: { method, routePath: route, path: route } } as unknown as Context;
}

const throwing = (err: unknown): Next => (() => Promise.reject(err)) as unknown as Next;

before(() => {
  homeRoot = mkdtempSync(join(tmpdir(), 'skill-map-bff-sentry-'));
  originalHome = process.env['HOME'];
  originalUserprofile = process.env['USERPROFILE'];
  originalKill = process.env['SKILL_MAP_TELEMETRY'];
  process.env['HOME'] = homeRoot;
  process.env['USERPROFILE'] = homeRoot;
});

after(() => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  if (originalUserprofile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = originalUserprofile;
  rmSync(homeRoot, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(homeRoot, '.skill-map'), { recursive: true, force: true });
  delete process.env['SKILL_MAP_TELEMETRY'];
  resetBffTelemetryForTests();
});

afterEach(() => {
  if (originalKill === undefined) delete process.env['SKILL_MAP_TELEMETRY'];
  else process.env['SKILL_MAP_TELEMETRY'] = originalKill;
  resetBffTelemetryForTests();
});

describe('shouldCaptureError', () => {
  it('does NOT capture expected 4xx HTTPExceptions (client errors)', () => {
    assert.equal(shouldCaptureError(new HTTPException(400, { message: 'bad body' })), false);
    assert.equal(shouldCaptureError(new HTTPException(404, { message: 'not found' })), false);
    assert.equal(shouldCaptureError(new HTTPException(413, { message: 'too large' })), false);
  });

  it('captures 5xx HTTPExceptions (server errors)', () => {
    assert.equal(shouldCaptureError(new HTTPException(500, { message: 'boom' })), true);
    assert.equal(shouldCaptureError(new HTTPException(503, { message: 'down' })), true);
  });

  it('captures any non-HTTPException throw (an uncaught bug)', () => {
    assert.equal(shouldCaptureError(new Error('unexpected')), true);
    assert.equal(shouldCaptureError(new TypeError('cannot read property')), true);
  });

  it('captures non-error throws (unexpected shapes)', () => {
    assert.equal(shouldCaptureError('a thrown string'), true);
    assert.equal(shouldCaptureError(undefined), true);
    assert.equal(shouldCaptureError({ weird: true }), true);
  });
});

describe('createSentryRequestCapture (Sentry spy, no network)', () => {
  it('captures a 5xx with route + method tags and rethrows', async () => {
    optIn();
    const fake = makeFakeSentry();
    await initSentryBff('1.0.0', loaderFor(fake));
    const mw = createSentryRequestCapture();
    await assert.rejects(
      mw(fakeContext('POST', '/api/probe'), throwing(new HTTPException(500, { message: 'boom' }))),
    );
    assert.equal(fake.captureException.mock.callCount(), 1);
    const tags = fake.setTag.mock.calls.map((c) => c.arguments);
    assert.deepEqual(tags, [
      ['route', '/api/probe'],
      ['method', 'POST'],
    ]);
  });

  it('does NOT capture an expected 4xx, but still rethrows', async () => {
    optIn();
    const fake = makeFakeSentry();
    await initSentryBff('1.0.0', loaderFor(fake));
    const mw = createSentryRequestCapture();
    await assert.rejects(
      mw(fakeContext('GET', '/api/x'), throwing(new HTTPException(400, { message: 'bad' }))),
    );
    assert.equal(fake.captureException.mock.callCount(), 0);
  });

  it('captures a non-HTTPException server crash', async () => {
    optIn();
    const fake = makeFakeSentry();
    await initSentryBff('1.0.0', loaderFor(fake));
    const mw = createSentryRequestCapture();
    await assert.rejects(mw(fakeContext('POST', '/api/y'), throwing(new Error('kaboom'))));
    assert.equal(fake.captureException.mock.callCount(), 1);
  });

  it('is a no-op (but still rethrows) when telemetry is inactive', async () => {
    // No initSentryBff: the module client stays null, so nothing is captured.
    const fake = makeFakeSentry();
    const mw = createSentryRequestCapture();
    await assert.rejects(
      mw(fakeContext('POST', '/api/z'), throwing(new HTTPException(500, { message: 'x' }))),
    );
    assert.equal(fake.captureException.mock.callCount(), 0);
  });
});
