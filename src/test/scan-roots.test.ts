/**
 * Coverage for `core/runtime/scan-roots:resolveScanRoots` — the
 * spec/cli-contract.md § Scan / Effective roots resolver.
 *
 * Behaviour pinned by these tests:
 *   - Positional roots win verbatim (preserved on `ScanResult.roots`).
 *   - `-g/--global` mutex with positional roots (defence-in-depth throw).
 *   - scope=global derives roots from `provider.explorationDir`
 *     entries that resolve against `~`; project-relative provider
 *     dirs are ignored.
 *   - scope=project: cwd + (includeHome ? HOME provider dirs : [])
 *     + extraRoots (resolved against cwd / ~).
 *   - Dedup across HOME + extras.
 *   - Empty provider list with scope=global falls back to `~`
 *     itself so the scan has at least one valid root.
 */

import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import type { IProvider } from '../kernel/extensions/index.js';
import { resolveScanRoots } from '../core/runtime/scan-roots.js';

function provider(id: string, explorationDir: string): IProvider {
  return {
    id,
    pluginId: id,
    kind: 'provider',
    version: '1.0.0',
    description: `Test provider ${id}`,
    stability: 'stable',
    explorationDir,
    read: { extensions: ['.md'], parser: 'frontmatter-yaml' },
    kinds: {},
    classify: () => null,
  };
}

describe('resolveScanRoots — positional roots', () => {
  it('positional roots win verbatim (no normalisation)', () => {
    const r = resolveScanRoots({
      positionalRoots: ['./a', '/abs/b'],
      scope: 'project',
      cwd: '/proj',
      homedir: '/home/u',
      providers: [],
      includeHome: true,
      extraRoots: ['~/extra'],
    });
    assert.deepEqual(r.roots, ['./a', '/abs/b']);
    assert.deepEqual(r.fromHome, []);
    assert.deepEqual(r.fromExtra, []);
  });
});

describe('resolveScanRoots — scope=global', () => {
  it('throws on positional roots + global (mutually exclusive)', () => {
    assert.throws(
      () =>
        resolveScanRoots({
          positionalRoots: ['./a'],
          scope: 'global',
          cwd: '/proj',
          homedir: '/home/u',
          providers: [],
          includeHome: false,
          extraRoots: [],
        }),
      /mutually exclusive/,
    );
  });

  it('derives HOME provider dirs from `~/...` explorationDir entries', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      scope: 'global',
      cwd: '/proj',
      homedir: '/home/u',
      providers: [
        provider('claude', '~/.claude'),
        provider('gemini', '~/.gemini'),
      ],
      includeHome: false,
      extraRoots: [],
    });
    assert.deepEqual(r.roots, [
      resolve('/home/u/.claude'),
      resolve('/home/u/.gemini'),
    ]);
    assert.deepEqual(r.fromHome, r.roots);
    assert.deepEqual(r.fromExtra, []);
  });

  it('skips project-relative provider explorationDirs (no leading ~)', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      scope: 'global',
      cwd: '/proj',
      homedir: '/home/u',
      providers: [
        provider('claude', '~/.claude'),
        provider('agent-skills', '.agents'),
      ],
      includeHome: false,
      extraRoots: [],
    });
    assert.deepEqual(r.roots, [resolve('/home/u/.claude')]);
  });

  it('falls back to ~ when no providers contribute HOME dirs', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      scope: 'global',
      cwd: '/proj',
      homedir: '/home/u',
      providers: [provider('agent-skills', '.agents')],
      includeHome: false,
      extraRoots: [],
    });
    assert.deepEqual(r.roots, [resolve('/home/u')]);
  });
});

describe('resolveScanRoots — scope=project', () => {
  it('cwd alone when no extras + includeHome=false', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      scope: 'project',
      cwd: '/proj',
      homedir: '/home/u',
      providers: [provider('claude', '~/.claude')],
      includeHome: false,
      extraRoots: [],
    });
    assert.deepEqual(r.roots, ['.']);
    assert.deepEqual(r.fromHome, []);
    assert.deepEqual(r.fromExtra, []);
  });

  it('cwd + HOME provider dirs when includeHome=true', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      scope: 'project',
      cwd: '/proj',
      homedir: '/home/u',
      providers: [
        provider('claude', '~/.claude'),
        provider('gemini', '~/.gemini'),
      ],
      includeHome: true,
      extraRoots: [],
    });
    assert.deepEqual(r.roots, [
      '.',
      resolve('/home/u/.claude'),
      resolve('/home/u/.gemini'),
    ]);
    assert.deepEqual(r.fromHome, [
      resolve('/home/u/.claude'),
      resolve('/home/u/.gemini'),
    ]);
  });

  it('cwd + extraRoots (~ + relative + absolute)', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      scope: 'project',
      cwd: '/proj',
      homedir: '/home/u',
      providers: [],
      includeHome: false,
      extraRoots: ['~/notes', './sub', '/abs/path'],
    });
    assert.deepEqual(r.roots, [
      '.',
      resolve('/home/u/notes'),
      resolve('/proj/sub'),
      resolve('/abs/path'),
    ]);
    assert.deepEqual(r.fromExtra, [
      resolve('/home/u/notes'),
      resolve('/proj/sub'),
      resolve('/abs/path'),
    ]);
  });

  it('dedupes a HOME dir that also appears in extraRoots', () => {
    const r = resolveScanRoots({
      positionalRoots: [],
      scope: 'project',
      cwd: '/proj',
      homedir: '/home/u',
      providers: [provider('claude', '~/.claude')],
      includeHome: true,
      extraRoots: ['~/.claude'],
    });
    assert.deepEqual(r.roots, ['.', resolve('/home/u/.claude')]);
  });
});
