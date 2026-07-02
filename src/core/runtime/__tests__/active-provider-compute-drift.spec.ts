/**
 * Coverage for the pure marker-drift surface extracted from
 * `core/runtime/active-provider-bootstrap` for the BFF:
 *
 *   - `computeMarkerDrift(cwd, providers)` returns the diff between the
 *     filesystem-detected marker set and the persisted
 *     `activeProviderMarkers` snapshot, or `null` when there is no
 *     snapshot or the sets match (no side effects).
 *   - `reconcileMarkersSnapshot(cwd, markers)` writes the snapshot and
 *     throws on write failure (the BFF "Dismiss" action catches it).
 *   - `bootstrapActiveProvider({ warnOnDrift: false })` suppresses the
 *     one-per-scan `⚠` warn on drift (the SERVER path) while still
 *     resolving the cached lens; the missing-snapshot backfill is
 *     unaffected.
 *
 * Companion to `active-provider-bootstrap-drift.spec.ts` (which pins the
 * CLI warn rendering with the default `warnOnDrift: true`).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  bootstrapActiveProvider,
  computeMarkerDrift,
  reconcileMarkersSnapshot,
} from '../active-provider-bootstrap.js';
import type { IProviderDetectInput } from '../../config/active-provider.js';
import type { IPrinter } from '../printer.js';

const TEST_PROVIDERS: IProviderDetectInput[] = [
  { id: 'claude', detect: { markers: ['.claude'] } },
  { id: 'cursor', detect: { markers: ['.cursor'] } },
  { id: 'codex', detect: { markers: ['.codex'] } },
];

interface ICapturedPrinter {
  printer: IPrinter;
  warns: string[];
}

function capturePrinter(): ICapturedPrinter {
  const warns: string[] = [];
  const printer: IPrinter = {
    info: () => {},
    warn: (s) => warns.push(s),
    error: () => {},
    data: () => {},
  };
  return { printer, warns };
}

function inlineStdin(text: string): Readable {
  return Readable.from([text]);
}

function noopStderr(): Writable {
  return new Writable({ write(_chunk, _enc, cb): void { cb(); } });
}

function readSettings(cwd: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(cwd, '.skill-map', 'settings.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function writeSettings(cwd: string, content: Record<string, unknown>): void {
  mkdirSync(join(cwd, '.skill-map'), { recursive: true });
  writeFileSync(
    join(cwd, '.skill-map', 'settings.json'),
    JSON.stringify({ schemaVersion: 1, ...content }),
  );
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sm-compute-drift-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('computeMarkerDrift', () => {
  it('returns the added / removed diff and the detected set when reality drifted', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.cursor'), { recursive: true });
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      activeProviderMarkers: ['claude'],
    });

    const drift = computeMarkerDrift(tmpRoot, TEST_PROVIDERS);
    assert.deepEqual(drift, {
      added: ['cursor'],
      removed: [],
      detected: ['claude', 'cursor'],
    });
  });

  it('returns null when the snapshot matches the detected set', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      activeProviderMarkers: ['claude'],
    });

    assert.equal(computeMarkerDrift(tmpRoot, TEST_PROVIDERS), null);
  });

  it('returns null when no snapshot exists (nothing to compare against)', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    // activeProvider set but no `activeProviderMarkers` snapshot (legacy).
    writeSettings(tmpRoot, { activeProvider: 'claude' });

    assert.equal(computeMarkerDrift(tmpRoot, TEST_PROVIDERS), null);
  });

  it('excludes ships-disabled providers from both sides of the diff', () => {
    // A snapshot written before `agent-skills` became experimental still
    // lists it; experimental providers never auto-detect, so without the
    // exclusion this would report a permanent false `removed`.
    const providers: IProviderDetectInput[] = [
      { id: 'claude', detect: { markers: ['.claude'] } },
      { id: 'agent-skills', detect: { markers: ['.agents'] }, stability: 'experimental' },
    ];
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.agents'), { recursive: true });
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      activeProviderMarkers: ['claude', 'agent-skills'],
    });

    assert.equal(computeMarkerDrift(tmpRoot, providers), null);
  });

  it('does not write anything (pure): the snapshot is untouched', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.cursor'), { recursive: true });
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      activeProviderMarkers: ['claude'],
    });

    computeMarkerDrift(tmpRoot, TEST_PROVIDERS);
    assert.deepEqual(readSettings(tmpRoot)['activeProviderMarkers'], ['claude']);
  });
});

describe('reconcileMarkersSnapshot', () => {
  it('writes the detected set as the activeProviderMarkers snapshot', () => {
    writeSettings(tmpRoot, { activeProvider: 'claude', activeProviderMarkers: ['claude'] });

    reconcileMarkersSnapshot(tmpRoot, ['claude', 'cursor']);
    assert.deepEqual(readSettings(tmpRoot)['activeProviderMarkers'], ['claude', 'cursor']);
  });

  it('reconciles away a drift so a follow-up computeMarkerDrift is null', () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.cursor'), { recursive: true });
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      activeProviderMarkers: ['claude'],
    });

    const before = computeMarkerDrift(tmpRoot, TEST_PROVIDERS);
    assert.ok(before !== null, 'precondition: drift present');
    reconcileMarkersSnapshot(tmpRoot, before.detected);
    assert.equal(computeMarkerDrift(tmpRoot, TEST_PROVIDERS), null);
  });
});

describe('bootstrapActiveProvider: warnOnDrift gate', () => {
  it('suppresses the drift warn when warnOnDrift is false (server path)', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.cursor'), { recursive: true });
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      activeProviderMarkers: ['claude'],
    });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: true,
      warnOnDrift: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    // Lens still resolves from config; only the warn is suppressed.
    assert.deepEqual(out, {
      kind: 'ok',
      activeProvider: 'claude',
      source: 'config',
    });
    assert.equal(cap.warns.length, 0, 'no drift warn on the server path');
    // Snapshot is NOT auto-refreshed by the suppressed drift path.
    assert.deepEqual(readSettings(tmpRoot)['activeProviderMarkers'], ['claude']);
  });

  it('still warns by default (warnOnDrift omitted) on the same drift', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.cursor'), { recursive: true });
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      activeProviderMarkers: ['claude'],
    });

    const cap = capturePrinter();
    await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: true,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(cap.warns.length, 1, 'default keeps the CLI warn');
  });

  it('still backfills the snapshot for a legacy project even when warnOnDrift is false', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    // Legacy project: activeProvider set, no markers snapshot.
    writeSettings(tmpRoot, { activeProvider: 'claude' });

    const cap = capturePrinter();
    await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: true,
      warnOnDrift: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(cap.warns.length, 0);
    // The missing-snapshot backfill is not gated by warnOnDrift.
    assert.deepEqual(readSettings(tmpRoot)['activeProviderMarkers'], ['claude']);
  });
});
