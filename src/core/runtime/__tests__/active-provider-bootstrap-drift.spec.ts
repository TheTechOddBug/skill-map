/**
 * Coverage for the active-provider marker drift detection added to
 * `core/runtime/active-provider-bootstrap`. Companion to
 * `active-provider-bootstrap.spec.ts`; that file pins the auto-detect /
 * prompt / ambiguous paths, this one pins the snapshot persistence +
 * the diff warn rendered at scan entry when the lens came from config.
 *
 * Behaviour pinned by these tests:
 *
 *   - Fresh project, single marker → bootstrap auto-detects + persists
 *     both `activeProvider` AND `activeProviderMarkers`. No warn.
 *   - Lens from config + snapshot equal to current set → no warn.
 *   - Lens from config + snapshot MISSING a marker that's now on disk
 *     → warn names the added id; scan continues with the cached lens.
 *   - Lens from config + snapshot LISTING a marker no longer on disk
 *     → warn names the removed id.
 *   - Lens from config + snapshot ABSENT (legacy project) → lazy
 *     backfill writes the current set as the snapshot; no warn the
 *     first time.
 *   - Ambiguous markers + valid stdin pick → persists both keys.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { bootstrapActiveProvider } from '../active-provider-bootstrap.js';
import type { IProviderDetectInput } from '../../config/active-provider.js';
import type { IPrinter } from '../printer.js';

/**
 * Detection markers for these drift tests. Provider-owned: the bootstrap
 * reads `detect.markers` off this list. `.codex` maps to `codex` so the
 * multi-marker drift case sees `codex` as the added id.
 */
const TEST_PROVIDERS: IProviderDetectInput[] = [
  { id: 'claude', detect: { markers: ['.claude'] } },
  { id: 'cursor', detect: { markers: ['.cursor'] } },
  { id: 'codex', detect: { markers: ['.codex'] } },
];

interface ICapturedPrinter {
  printer: IPrinter;
  warns: string[];
  infos: string[];
  errors: string[];
}

function capturePrinter(): ICapturedPrinter {
  const warns: string[] = [];
  const infos: string[] = [];
  const errors: string[] = [];
  const printer: IPrinter = {
    info: (s) => infos.push(s),
    warn: (s) => warns.push(s),
    error: (s) => errors.push(s),
    data: () => {},
  };
  return { printer, warns, infos, errors };
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'sm-active-provider-drift-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('bootstrapActiveProvider: snapshot persistence on auto-detect', () => {
  it('persists activeProvider AND activeProviderMarkers from a single marker', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.deepEqual(out, {
      kind: 'ok',
      activeProvider: 'claude',
      source: 'autodetect',
    });
    const persisted = readSettings(tmpRoot);
    assert.equal(persisted['activeProvider'], 'claude');
    assert.deepEqual(persisted['activeProviderMarkers'], ['claude']);
    // Only the auto-detect info line, no drift warn.
    assert.equal(cap.warns.length, 0);
  });

  it('persists both keys after an interactive ambiguous pick', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.cursor'), { recursive: true });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: false,
      stdin: inlineStdin('2\n'), // pick cursor
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(out.kind, 'ok');
    if (out.kind !== 'ok') return;
    assert.equal(out.activeProvider, 'cursor');
    const persisted = readSettings(tmpRoot);
    assert.equal(persisted['activeProvider'], 'cursor');
    // Snapshot reflects the ambiguous set shown to the operator,
    // both markers detected at the moment of choice.
    assert.deepEqual(persisted['activeProviderMarkers'], ['claude', 'cursor']);
  });
});

describe('bootstrapActiveProvider: drift detection from config', () => {
  it('no warn when the snapshot matches the current marker set', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      activeProviderMarkers: ['claude'],
    });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.deepEqual(out, {
      kind: 'ok',
      activeProvider: 'claude',
      source: 'config',
    });
    assert.equal(cap.warns.length, 0, 'no drift warn');
  });

  it('warns once when a new marker appeared since the snapshot', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.cursor'), { recursive: true });
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      // Snapshot taken when only .claude was on disk; .cursor appeared later.
      activeProviderMarkers: ['claude'],
    });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(out.kind, 'ok');
    if (out.kind !== 'ok') return;
    // Lens stays the same; the warn is informational and never blocks.
    assert.equal(out.activeProvider, 'claude');
    assert.equal(cap.warns.length, 1, 'exactly one drift warn');
    assert.match(cap.warns[0]!, /Provider markers changed/);
    assert.match(cap.warns[0]!, /New: cursor/);
    assert.match(cap.warns[0]!, /Removed: \(none\)/);
    assert.match(cap.warns[0]!, /keep using `claude`/);
  });

  it('warns once when a previously-recorded marker disappeared', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    // No `.cursor/` on disk anymore.
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      activeProviderMarkers: ['claude', 'cursor'],
    });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(out.kind, 'ok');
    if (out.kind !== 'ok') return;
    assert.equal(out.activeProvider, 'claude');
    assert.equal(cap.warns.length, 1);
    assert.match(cap.warns[0]!, /New: \(none\)/);
    assert.match(cap.warns[0]!, /Removed: cursor/);
  });

  it('warns once even when multiple markers drift in both directions', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.codex'), { recursive: true });
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      // Was [claude, cursor], now [claude, codex] (cursor gone, codex new).
      activeProviderMarkers: ['claude', 'cursor'],
    });

    const cap = capturePrinter();
    await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(cap.warns.length, 1, 'one warn even with multi-marker drift');
    assert.match(cap.warns[0]!, /New: codex/);
    assert.match(cap.warns[0]!, /Removed: cursor/);
  });

  it('does not warn when the only snapshot drift is an experimental provider', async () => {
    // A snapshot written before a provider became experimental still lists
    // it. Experimental providers ship disabled and are never auto-detected,
    // so the diff must ignore the stale entry instead of reporting a
    // permanent false "Removed" on every scan.
    const providers: IProviderDetectInput[] = [
      { id: 'claude', detect: { markers: ['.claude'] } },
      { id: 'agent-skills', detect: { markers: ['.agents'] }, stability: 'experimental' },
    ];
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    // `.agents/` present too, but agent-skills is experimental so it never
    // auto-detects, mirroring the real registry.
    mkdirSync(join(tmpRoot, '.agents'), { recursive: true });
    writeSettings(tmpRoot, {
      activeProvider: 'claude',
      activeProviderMarkers: ['claude', 'agent-skills'],
    });

    const cap = capturePrinter();
    await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers,
      yes: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(cap.warns.length, 0, 'experimental snapshot entry must not trigger drift');
  });

  it('backfills the snapshot silently for a legacy project (no warn)', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    // Legacy project: activeProvider set, but no markers snapshot exists.
    writeSettings(tmpRoot, { activeProvider: 'claude' });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(out.kind, 'ok');
    assert.equal(cap.warns.length, 0, 'silent on first scan after upgrade');
    // Snapshot landed in settings so the NEXT scan can diff against it.
    const persisted = readSettings(tmpRoot);
    assert.deepEqual(persisted['activeProviderMarkers'], ['claude']);
  });

  it('does not refresh the snapshot when drift fires (operator decides)', async () => {
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
      yes: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });
    assert.equal(cap.warns.length, 1, 'first scan warns');

    // Snapshot is unchanged: a second scan with the same drift warns
    // again. The operator is expected to either switch lens via
    // `sm config set activeProvider <id>` or accept the drift by
    // re-running the auto-detect (deleting `activeProvider` first).
    const persisted = readSettings(tmpRoot);
    assert.deepEqual(persisted['activeProviderMarkers'], ['claude']);
  });

  it('renders the warn glyph through the style.warnGlyph override', async () => {
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
      yes: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
      style: {
        warnGlyph: '<YELLOW-WARN>',
        dim: (s) => `<DIM>${s}</DIM>`,
      },
    });

    assert.equal(cap.warns.length, 1);
    assert.match(cap.warns[0]!, /<YELLOW-WARN>/);
    assert.match(cap.warns[0]!, /<DIM>.*<\/DIM>/);
  });
});
