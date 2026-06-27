/**
 * Unit coverage for `detectProvidersFromFilesystem`, the pure filesystem
 * lens auto-detection. Focus: the **fallback precedence** rule, a Provider
 * flagged `detect.fallback` (the open-standard `agent-skills` lens) is a
 * candidate ONLY when no vendor (non-fallback) Provider matched, so the
 * shared `.agents/` skill home never turns a single-vendor project into an
 * ambiguous prompt.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectProvidersFromFilesystem,
  type IProviderDetectInput,
} from '../detect-providers.js';

// Registration-order catalog mirroring the real built-ins: vendor lenses
// first, the open-standard fallback last. `agent-skills` carries
// `fallback: true`; every other entry is a vendor (non-fallback) lens.
const CATALOG: IProviderDetectInput[] = [
  { id: 'claude', detect: { markers: ['.claude'] } },
  { id: 'codex', detect: { markers: ['.codex'] } },
  { id: 'antigravity', detect: { markers: ['.agent/workflows'] } },
  { id: 'agent-skills', detect: { markers: ['.agents'], fallback: true } },
];

let tmpRoot: string;

function seed(...markers: string[]): void {
  for (const marker of markers) {
    mkdirSync(join(tmpRoot, marker), { recursive: true });
  }
}

describe('detectProvidersFromFilesystem: fallback precedence', () => {
  // Fresh tmp dir per case: `seed` only creates marker dirs, so reusing
  // one root would leak markers from earlier cases into later ones.
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-detect-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns [] when no marker is present', () => {
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), []);
  });

  it('returns the open fallback alone when only `.agents/` is present', () => {
    seed('.agents');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), ['agent-skills']);
  });

  it('drops the fallback when a vendor marker also matched (codex + .agents)', () => {
    // The scaffold case: `sm tutorial --for codex` drops `.codex/` and lays
    // skills under `.agents/skills/`. Precedence resolves codex outright.
    seed('.codex', '.agents');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), ['codex']);
  });

  it('drops the fallback for antigravity too (.agent/workflows + .agents)', () => {
    seed('.agent/workflows', '.agents');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), ['antigravity']);
  });

  it('keeps multiple VENDOR markers ambiguous, only the fallback drops', () => {
    // Two real vendors plus the shared `.agents/` home: the fallback is
    // removed but the two vendors remain, a genuine ambiguous list.
    seed('.claude', '.codex', '.agents');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), ['claude', 'codex']);
  });

  it('preserves Provider registration order for the surviving vendors', () => {
    seed('.claude', '.codex', '.agent/workflows', '.agents');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), [
      'claude',
      'codex',
      'antigravity',
    ]);
  });
});
