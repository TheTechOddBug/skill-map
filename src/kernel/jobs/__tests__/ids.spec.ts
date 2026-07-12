/**
 * Unit tests for job-id + nonce generation. Pins the spec id shape
 * (`job.schema.json#/properties/id`) and the >= 128-bit nonce floor.
 */

import { describe, it } from 'node:test';
import { strictEqual, match, throws, notStrictEqual } from 'node:assert';

import { generateJobId, generateNonce } from '../ids.js';

describe('generateJobId', () => {
  it('matches the spec pattern d-YYYYMMDD-HHMMSS-XXXX', () => {
    match(generateJobId(), /^d-\d{8}-\d{6}-[0-9a-f]{4}$/);
  });

  it('formats a fixed timestamp (UTC) + injected suffix deterministically', () => {
    const now = new Date(Date.UTC(2026, 6, 12, 8, 5, 3));
    strictEqual(generateJobId(now, () => 'ab12'), 'd-20260712-080503-ab12');
  });

  it('varies the suffix across calls at the same instant', () => {
    const now = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const a = generateJobId(now);
    const b = generateJobId(now);
    // Same time prefix, different random tail (overwhelmingly likely).
    strictEqual(a.slice(0, 18), b.slice(0, 18));
    notStrictEqual(a, b);
  });
});

describe('generateNonce', () => {
  it('defaults to 128 bits (32 hex chars)', () => {
    match(generateNonce(), /^[0-9a-f]{32}$/);
  });

  it('honours a larger byte request', () => {
    strictEqual(generateNonce(32).length, 64);
  });

  it('refuses fewer than 16 bytes (< 128 bits)', () => {
    throws(() => generateNonce(8), /128 bits/);
  });
});
