/**
 * Coverage for `core/plugins/enable-persist`, the enable-toggle writer
 * with redundant-key pruning (spec/architecture.md §Locality, "A toggle
 * persists only what the default does not already say").
 *
 * Behaviour pinned by these tests:
 *   - a flip TO the installed default writes nothing and removes an
 *     existing key (and prunes the emptied ancestors);
 *   - a flip AWAY from the installed default persists;
 *   - redundancy is decided against the OTHER layer, not against the
 *     default alone (the `--local` re-enable over a committed `false`
 *     must persist);
 *   - the plugin-level `plugins.<p>.enabled` acts as the fallback and is
 *     itself never pruned;
 *   - an id with no known installed default is written and never pruned;
 *   - the sweep prunes redundant keys the layer already carried, even
 *     when the batch does not name them, and stays inside the target
 *     layer.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, beforeEach } from 'node:test';

import {
  buildInstalledDefaults,
  persistEnableToggles,
  unloadedDefaultSources,
} from '../enable-persist.js';
import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';

let cwd: string;

/** `stable` ships on, `experimental` ships off. */
const DEFAULTS = buildInstalledDefaults([
  { key: 'core/markdown-link', stability: 'stable' },
  { key: 'core/lab-thing', stability: 'experimental' },
  { key: 'core/opt-in', stability: 'stable', defaultEnabled: false },
]);

beforeEach(() => {
  cwd = join(mkdtempSync(join(tmpdir(), 'enable-persist-')), 'project');
  mkdirSync(join(cwd, '.skill-map'), { recursive: true });
});

function writeLayer(target: 'project' | 'project-local', content: unknown): void {
  const name = target === 'project' ? 'settings.json' : 'settings.local.json';
  writeFileSync(join(cwd, '.skill-map', name), JSON.stringify(content), 'utf8');
}

function readLayer(target: 'project' | 'project-local'): Record<string, unknown> {
  const name = target === 'project' ? 'settings.json' : 'settings.local.json';
  try {
    return JSON.parse(readFileSync(join(cwd, '.skill-map', name), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function extEnabled(
  layer: Record<string, unknown>,
  plugin: string,
  ext: string,
): unknown {
  const plugins = layer['plugins'] as Record<string, Record<string, never>> | undefined;
  const extensions = plugins?.[plugin]?.['extensions'] as
    | Record<string, { enabled?: unknown }>
    | undefined;
  return extensions?.[ext]?.enabled;
}

function persist(
  changes: Array<{ key: string; enabled: boolean }>,
  target: 'project' | 'project-local' = 'project',
): ReturnType<typeof persistEnableToggles> {
  return persistEnableToggles({ changes, installedDefaults: DEFAULTS, target, cwd });
}

describe('persistEnableToggles: redundant keys', () => {
  it('writes nothing when the requested state is already the installed default', () => {
    const result = persist([{ key: 'core/markdown-link', enabled: true }]);

    assert.deepEqual(result, { written: [], pruned: [] });
    assert.deepEqual(readLayer('project'), {});
  });

  it('removes an existing key once the toggle returns to the default', () => {
    writeLayer('project', {
      plugins: { core: { extensions: { 'markdown-link': { enabled: false } } } },
    });

    const result = persist([{ key: 'core/markdown-link', enabled: true }]);

    assert.deepEqual(result.pruned, ['plugins.core.extensions.markdown-link.enabled']);
    // Emptied ancestors go with it, so the file does not accumulate husks.
    assert.deepEqual(readLayer('project'), {});
  });

  it('persists a flip away from the installed default', () => {
    const result = persist([{ key: 'core/markdown-link', enabled: false }]);

    assert.deepEqual(result.written, ['plugins.core.extensions.markdown-link.enabled']);
    assert.equal(extEnabled(readLayer('project'), 'core', 'markdown-link'), false);
  });

  it('persists enabling an extension that ships disabled', () => {
    persist([{ key: 'core/lab-thing', enabled: true }]);
    assert.equal(extEnabled(readLayer('project'), 'core', 'lab-thing'), true);

    // ... and drops it again on the way back off.
    const back = persist([{ key: 'core/lab-thing', enabled: false }]);
    assert.deepEqual(back.pruned, ['plugins.core.extensions.lab-thing.enabled']);
    assert.deepEqual(readLayer('project'), {});
  });

  it('honours a manifest `defaultEnabled: false` over the stability default', () => {
    persist([{ key: 'core/opt-in', enabled: true }]);
    assert.equal(extEnabled(readLayer('project'), 'core', 'opt-in'), true);
  });

  it('never prunes an id whose installed default is unknown', () => {
    const result = persistEnableToggles({
      changes: [{ key: 'mystery/ext', enabled: true }],
      installedDefaults: DEFAULTS,
      target: 'project',
      cwd,
    });

    assert.deepEqual(result.written, ['plugins.mystery.extensions.ext.enabled']);
    assert.equal(extEnabled(readLayer('project'), 'mystery', 'ext'), true);
  });
});

describe('persistEnableToggles: layer interplay', () => {
  it('persists a local re-enable that a committed `false` would otherwise win', () => {
    writeLayer('project', {
      plugins: { core: { extensions: { 'markdown-link': { enabled: false } } } },
    });

    // The value equals the installed default, but dropping the key would
    // resolve to the committed `false`, so it is NOT redundant.
    const result = persist([{ key: 'core/markdown-link', enabled: true }], 'project-local');

    assert.deepEqual(result.written, ['plugins.core.extensions.markdown-link.enabled']);
    assert.equal(extEnabled(readLayer('project-local'), 'core', 'markdown-link'), true);
    // The committed layer is untouched by a --local write.
    assert.equal(extEnabled(readLayer('project'), 'core', 'markdown-link'), false);
  });

  it('prunes against a plugin-level enabled and leaves that key alone', () => {
    writeLayer('project', {
      plugins: {
        core: { enabled: false, extensions: { 'markdown-link': { enabled: false } } },
      },
    });

    const result = persist([{ key: 'core/markdown-link', enabled: false }]);

    assert.deepEqual(result.pruned, ['plugins.core.extensions.markdown-link.enabled']);
    const layer = readLayer('project');
    assert.equal(extEnabled(layer, 'core', 'markdown-link'), undefined);
    assert.deepEqual(layer, { plugins: { core: { enabled: false } } });
  });
});

describe('persistEnableToggles: sweep', () => {
  it('prunes redundant keys the batch does not name', () => {
    writeLayer('project', {
      plugins: {
        core: {
          extensions: {
            // Redundant: restates the stable default.
            'markdown-link': { enabled: true },
            // Redundant: restates the experimental default.
            'lab-thing': { enabled: false },
            // Not redundant, and not part of the batch: stays.
            'opt-in': { enabled: true },
          },
        },
      },
    });

    const result = persist([{ key: 'core/lab-thing', enabled: false }]);

    assert.deepEqual(result.written, []);
    assert.deepEqual(result.pruned.sort(), [
      'plugins.core.extensions.lab-thing.enabled',
      'plugins.core.extensions.markdown-link.enabled',
    ]);
    assert.deepEqual(readLayer('project'), {
      plugins: { core: { extensions: { 'opt-in': { enabled: true } } } },
    });
  });

  it('does not sweep the layer the caller is not writing', () => {
    writeLayer('project', {
      plugins: { core: { extensions: { 'markdown-link': { enabled: true } } } },
    });

    persist([{ key: 'core/lab-thing', enabled: true }], 'project-local');

    assert.equal(extEnabled(readLayer('project'), 'core', 'markdown-link'), true);
    assert.equal(extEnabled(readLayer('project-local'), 'core', 'lab-thing'), true);
  });

  it('leaves neighbouring config untouched while pruning', () => {
    // Everything that is not a per-extension `enabled` must survive: the
    // sweep walks one specific shape, it does not rewrite the file.
    writeLayer('project', {
      tokenizer: 'o200k_base',
      plugins: {
        core: {
          extensions: {
            'markdown-link': { enabled: true, settings: { maxDepth: 3 } },
          },
        },
      },
    });

    persist([{ key: 'core/markdown-link', enabled: true }]);

    assert.deepEqual(readLayer('project'), {
      tokenizer: 'o200k_base',
      plugins: { core: { extensions: { 'markdown-link': { settings: { maxDepth: 3 } } } } },
    });
  });

  it('ignores a non-boolean value planted by hand', () => {
    writeLayer('project', {
      plugins: { core: { extensions: { 'lab-thing': { enabled: 'yes' } } } },
    });

    // The sweep cannot reason about it, and the batch names nothing, so
    // the pass is a no-op rather than a crash or a silent rewrite.
    const result = persist([]);

    assert.deepEqual(result, { written: [], pruned: [] });
    assert.equal(extEnabled(readLayer('project'), 'core', 'lab-thing'), 'yes');
  });
});

describe('persistEnableToggles: batches', () => {
  it('applies a mixed enable + disable batch in one pass', () => {
    const result = persist([
      { key: 'core/markdown-link', enabled: false }, // away from the default → written
      { key: 'core/lab-thing', enabled: true }, // away from the default → written
      { key: 'core/opt-in', enabled: false }, // already the default → nothing
    ]);

    assert.deepEqual(result.written.sort(), [
      'plugins.core.extensions.lab-thing.enabled',
      'plugins.core.extensions.markdown-link.enabled',
    ]);
    assert.deepEqual(result.pruned, []);
    assert.equal(extEnabled(readLayer('project'), 'core', 'opt-in'), undefined);
  });

  it('is idempotent: replaying the same batch changes nothing', () => {
    persist([{ key: 'core/markdown-link', enabled: false }]);
    const before = readLayer('project');

    const again = persist([{ key: 'core/markdown-link', enabled: false }]);

    assert.deepEqual(again, { written: [], pruned: [] });
    assert.deepEqual(readLayer('project'), before);
  });

  it('creates no settings file when there is nothing to persist', () => {
    const result = persist([{ key: 'core/markdown-link', enabled: true }]);

    assert.deepEqual(result, { written: [], pruned: [] });
    assert.equal(existsSync(join(cwd, '.skill-map', 'settings.json')), false);
  });
});

describe('unloadedDefaultSources', () => {
  it('projects declared-but-unimported extensions, which is what a re-enable needs', () => {
    // A disabled extension is not imported (pre-import enable gate), so
    // its manifest only shows up here; without it the default would read
    // as unknown and the redundant key would survive the re-enable.
    const discovered = [
      {
        path: '/x',
        id: 'mock',
        status: 'enabled',
        extensions: [],
        unloadedExtensions: [
          {
            kind: 'extractor',
            id: 'plain',
            pluginId: 'mock',
            version: '0.1.0',
            description: 'mock',
            entryPath: '/x/extractors/plain/index.js',
            reason: 'extension-disabled',
          },
          {
            kind: 'extractor',
            id: 'lab',
            pluginId: 'mock',
            version: '0.1.0',
            description: 'mock',
            stability: 'experimental',
            entryPath: '/x/extractors/lab/index.js',
            reason: 'extension-disabled',
          },
        ],
      },
    ] as unknown as IDiscoveredPlugin[];

    const defaults = buildInstalledDefaults(unloadedDefaultSources(discovered));

    assert.equal(defaults.get('mock/plain'), true);
    assert.equal(defaults.get('mock/lab'), false);
  });

  it('yields nothing for a plugin with no unloaded extensions', () => {
    const discovered = [
      { path: '/x', id: 'mock', status: 'enabled', extensions: [] },
    ] as unknown as IDiscoveredPlugin[];

    assert.deepEqual(unloadedDefaultSources(discovered), []);
  });
});
