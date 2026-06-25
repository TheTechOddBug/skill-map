/**
 * Coverage for `core/runtime/active-provider-bootstrap:bootstrapActiveProvider`,
 * the spec/cli-contract.md §Auto-detect handler that resolves the
 * active provider lens at scan entry.
 *
 * Behaviour pinned by these tests:
 *
 *   - When `settings.json` carries `activeProvider`, the bootstrap is
 *     a no-op (returns 'ok' source='config' verbatim). No filesystem
 *     scan, no persistence.
 *   - No markers anywhere → `activeProvider: 'agent-skills'`, source='default',
 *     no warning, no persist. Plain-markdown projects keep scanning fine
 *     under the open-standard default lens; a vendor marker added later
 *     still auto-detects on the next scan.
 *   - One marker → auto-detect + persist to `.skill-map/settings.json`
 *     (project layer), source='autodetect'. Subsequent scans pick up
 *     the value from config without re-detecting.
 *   - Multiple markers + `yes: true` → returns `kind: 'ambiguous'`.
 *     The caller exits non-zero so the operator runs
 *     `sm config set activeProvider <id>` and retries.
 *   - Multiple markers + `yes: false` + valid stdin input → persists
 *     the chosen id (by number or by name), source='autodetect'.
 *   - Multiple markers + `yes: false` + invalid stdin input → falls
 *     through to `kind: 'ambiguous'`. The caller surfaces the same
 *     "set it manually" message as the `--yes` path.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  bootstrapActiveProvider,
  warnIfLensPluginDisabled,
} from '../active-provider-bootstrap.js';
import type { IProviderDetectInput } from '../../config/active-provider.js';
import type { IPrinter } from '../printer.js';

/**
 * Detection markers for these tests. Provider-owned now: the bootstrap
 * reads `detect.markers` off the provider list instead of a hardcoded
 * table. Order is significant for the ambiguous-detection cases (first
 * match is the default suggestion).
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

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sm-active-provider-bootstrap-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('bootstrapActiveProvider: from settings', () => {
  it('returns the persisted value when settings.json has activeProvider', async () => {
    mkdirSync(join(tmpRoot, '.skill-map'), { recursive: true });
    writeFileSync(
      join(tmpRoot, '.skill-map', 'settings.json'),
      JSON.stringify({ schemaVersion: 1, activeProvider: 'claude' }),
    );

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

    assert.deepEqual(out, { kind: 'ok', activeProvider: 'claude', source: 'config' });
    assert.equal(cap.infos.length, 0, 'no auto-detect message');
    assert.equal(cap.warns.length, 0, 'no warning');
  });
});

describe('bootstrapActiveProvider: no markers anywhere', () => {
  it('resolves to the open-standard default lens silently, no warning, no persist', async () => {
    // tmpRoot is empty: no markers in cwd, no markers in any root.
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

    assert.deepEqual(out, { kind: 'ok', activeProvider: 'agent-skills', source: 'default' });
    assert.equal(cap.warns.length, 0, 'no warning printed for the default lens');
    // The default lens is NOT persisted: a vendor marker added later
    // must still auto-detect on the next scan.
    assert.equal(
      existsSync(join(tmpRoot, '.skill-map', 'settings.json')),
      false,
      'default lens must not be written to settings.json',
    );
  });
});

describe('bootstrapActiveProvider: single marker', () => {
  it('detects .claude/, persists to settings.json, returns autodetect', async () => {
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

    assert.deepEqual(out, { kind: 'ok', activeProvider: 'claude', source: 'autodetect' });
    // Persisted to project settings.
    const persisted = JSON.parse(
      readFileSync(join(tmpRoot, '.skill-map', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(persisted['activeProvider'], 'claude');
    // The bootstrap no longer prints the auto-detect line itself, the
    // caller announces it on the scan-summary stream (`source:
    // 'autodetect'` in the outcome is the signal). So no info here.
    assert.equal(cap.infos.length, 0, 'bootstrap stays silent; caller announces');
  });

  it('detects markers in an effective root when cwd is unrelated', async () => {
    // cwd has no markers; the scan root carries them. Out-of-tree
    // invocation (tests, `sm scan PATH`).
    const fixture = join(tmpRoot, 'fixture');
    mkdirSync(join(fixture, '.cursor'), { recursive: true });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [fixture],
      providers: TEST_PROVIDERS,
      yes: false,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(out.kind, 'ok');
    if (out.kind !== 'ok') return;
    assert.equal(out.activeProvider, 'cursor');
    assert.equal(out.source, 'autodetect');
  });
});

describe('bootstrapActiveProvider: ambiguous (multiple markers)', () => {
  it('returns kind=ambiguous under yes:true (no prompt)', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.cursor'), { recursive: true });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: true,
      stdin: inlineStdin(''),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(out.kind, 'ambiguous');
    if (out.kind !== 'ambiguous') return;
    assert.deepEqual([...out.detected], ['claude', 'cursor']);
    assert.equal(cap.infos.length, 0, 'no auto-detect message (did not auto-pick)');
  });

  it('persists the picked id when stdin provides a valid number', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.cursor'), { recursive: true });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: false,
      // "2\n" picks the second detected provider, cursor.
      stdin: inlineStdin('2\n'),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(out.kind, 'ok');
    if (out.kind !== 'ok') return;
    assert.equal(out.activeProvider, 'cursor');
    assert.equal(out.source, 'autodetect');
    const persisted = JSON.parse(
      readFileSync(join(tmpRoot, '.skill-map', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(persisted['activeProvider'], 'cursor');
  });

  it('persists the picked id when stdin provides a valid name', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.cursor'), { recursive: true });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: false,
      stdin: inlineStdin('Cursor\n'), // case-insensitive name match
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(out.kind, 'ok');
    if (out.kind !== 'ok') return;
    assert.equal(out.activeProvider, 'cursor');
  });

  it('falls through to ambiguous when stdin input is invalid', async () => {
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    mkdirSync(join(tmpRoot, '.cursor'), { recursive: true });

    const cap = capturePrinter();
    const out = await bootstrapActiveProvider({
      cwd: tmpRoot,
      effectiveRoots: [tmpRoot],
      providers: TEST_PROVIDERS,
      yes: false,
      stdin: inlineStdin('garbage\n'),
      stderr: noopStderr(),
      printer: cap.printer,
    });

    assert.equal(out.kind, 'ambiguous');
    if (out.kind !== 'ambiguous') return;
    assert.deepEqual([...out.detected], ['claude', 'cursor']);
  });
});

describe('warnIfLensPluginDisabled (bd-23c regression)', () => {
  it('warns when activeProvider points at a disabled plugin', () => {
    const cap = capturePrinter();
    warnIfLensPluginDisabled({
      activeProvider: 'claude',
      resolveEnabled: () => false, // every plugin reads as disabled
      printer: cap.printer,
    });
    assert.equal(cap.warns.length, 1);
    assert.match(cap.warns[0]!, /activeProvider = "claude"/);
    assert.match(cap.warns[0]!, /"claude" plugin is currently disabled/);
    assert.match(cap.warns[0]!, /sm plugins enable claude/);
  });

  it('silent when the lens plugin is enabled (the happy path)', () => {
    const cap = capturePrinter();
    warnIfLensPluginDisabled({
      activeProvider: 'claude',
      resolveEnabled: () => true,
      printer: cap.printer,
    });
    assert.equal(cap.warns.length, 0);
  });

  it('only warns when the specific lens plugin is disabled (selective)', () => {
    const cap = capturePrinter();
    // claude enabled, antigravity disabled; lens=antigravity → warn about antigravity only.
    warnIfLensPluginDisabled({
      activeProvider: 'antigravity',
      resolveEnabled: (id) => id === 'claude',
      printer: cap.printer,
    });
    assert.equal(cap.warns.length, 1);
    assert.match(cap.warns[0]!, /"antigravity" plugin is currently disabled/);
    // Same scenario but lens=claude → no warning.
    const cap2 = capturePrinter();
    warnIfLensPluginDisabled({
      activeProvider: 'claude',
      resolveEnabled: (id) => id === 'claude',
      printer: cap2.printer,
    });
    assert.equal(cap2.warns.length, 0);
  });
});
