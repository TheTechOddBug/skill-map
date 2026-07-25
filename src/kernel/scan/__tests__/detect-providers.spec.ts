/**
 * Unit coverage for `detectProvidersFromFilesystem`, the pure filesystem
 * lens auto-detection. Two rules under test:
 *
 *   - **fallback precedence**: a Provider flagged `detect.fallback` (the
 *     open-standard `agent-skills` lens) is a candidate ONLY when no vendor
 *     (non-fallback) Provider matched, so the shared `.agents/` skill home
 *     never turns a single-vendor project into an ambiguous prompt.
 *   - **compat subsumption**: a Provider's `detect.subsumes` absorbs the
 *     candidates it names, so `.claude/` + `.opencode/` resolves to
 *     `opencode` instead of prompting over a tie that does not exist.
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
  { id: 'opencode', detect: { markers: ['.opencode'], subsumes: ['claude'] } },
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

describe('detectProvidersFromFilesystem: compat subsumption', () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-detect-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('absorbs the subsumed vendor (.claude + .opencode resolves to opencode)', () => {
    // OpenCode READS `.claude/skills/`, so `.claude/` inside an OpenCode
    // project is expected, not a second runtime. No prompt.
    seed('.claude', '.opencode');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), ['opencode']);
  });

  it('absorbs across the fallback rule too (.claude + .opencode + .agents)', () => {
    seed('.claude', '.opencode', '.agents');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), ['opencode']);
  });

  it('leaves the subsumed vendor alone when the subsumer did not match', () => {
    seed('.claude');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), ['claude']);
  });

  it('keeps a vendor it does not subsume ambiguous (.codex + .opencode)', () => {
    seed('.codex', '.opencode');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), ['codex', 'opencode']);
  });

  it('subsumes only its own target, the third vendor stays (.claude + .codex + .opencode)', () => {
    seed('.claude', '.codex', '.opencode');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), ['codex', 'opencode']);
  });

  it('keeps a mutual pair ambiguous rather than tie-breaking arbitrarily', () => {
    const mutual: IProviderDetectInput[] = [
      { id: 'alpha', detect: { markers: ['.alpha'], subsumes: ['beta'] } },
      { id: 'beta', detect: { markers: ['.beta'], subsumes: ['alpha'] } },
    ];
    seed('.alpha', '.beta');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, mutual), ['alpha', 'beta']);
  });

  it('ignores a subsumes entry naming a provider that is not a candidate', () => {
    seed('.opencode');
    deepStrictEqual(detectProvidersFromFilesystem(tmpRoot, CATALOG), ['opencode']);
  });
});
