/**
 * Unit tests for the BFF telemetry capture policy
 * (`server/telemetry/sentry.ts`). Only the pure `shouldCaptureError`
 * decision is exercised: it is what keeps routine client errors (4xx) out
 * of the Sentry issue stream while still reporting real server failures.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { shouldCaptureError } from '../sentry.js';

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
