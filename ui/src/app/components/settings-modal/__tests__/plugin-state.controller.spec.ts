import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { setupPluginState } from '../plugin-state.controller';
import type {
  IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import type {
  IListEnvelopeApi,
  IPluginExtensionApi,
  IPluginItemApi,
} from '../../../../models/api';

/**
 * plugin-state.controller, buffered fetch / toggle / apply state
 * machine. Tests target the handle's imperative surface (mirrors the
 * existing SettingsPlugins spec style) plus the dirty-set computeds.
 */

function pluginsEnvelope(items: IPluginItemApi[]): IListEnvelopeApi<IPluginItemApi> {
  return {
    schemaVersion: '1',
    kind: 'plugins',
    items,
    filters: {},
    counts: { total: items.length, returned: items.length },
    kindRegistry: {},
  };
}

function plugin(
  id: string,
  overrides: Partial<IPluginItemApi> = {},
): IPluginItemApi {
  const status = overrides.status ?? 'enabled';
  return {
    id,
    version: '1.0.0',
    kinds: ['provider'],
    status,
    reason: null,
    source: 'built-in',
    // Every plugin ships at least one extension. The plugin is just a
    // presentational grouping (no toggle of its own); the inline
    // extension carries the per-extension toggle axis the controller
    // tracks via `onExtensionToggle`. Mirrors the production single-
    // extension provider plugins like `openai/openai`.
    extensions: [
      { id, kind: 'provider', version: '1.0.0', enabled: status === 'enabled' },
    ],
    ...overrides,
  };
}

/**
 * Flip the plugin's first extension via `onExtensionToggle`. Replaces
 * the legacy `onBundleToggle` calls now that the plugin itself has no
 * toggle axis.
 */
function toggleBundleAggregate(
  handle: ReturnType<typeof setupPluginState>,
  plugin: IPluginItemApi,
  next: boolean,
): void {
  const ext = (plugin.extensions ?? [])[0];
  if (!ext) throw new Error(`plugin ${plugin.id} has no extensions to toggle`);
  handle.onExtensionToggle(plugin.id, ext, next);
}

interface IDeps {
  dataSource: Partial<IDataSourcePort>;
  scanRun: ReturnType<typeof vi.fn>;
}

function setupDeps(dataSource: Partial<IDataSourcePort>): IDeps {
  const scanRun = vi.fn().mockResolvedValue(undefined);
  return { dataSource, scanRun };
}

function make(deps: IDeps) {
  return setupPluginState({
    dataSource: deps.dataSource as IDataSourcePort,
    // Typed cast: the controller only needs a callable `run` that
    // returns something awaitable; the vitest spy satisfies that at
    // runtime even when its strict generic doesn't widen to the
    // service's `() => Promise<void>` signature.
    scanTrigger: { run: deps.scanRun as unknown as () => Promise<void> },
  });
}

describe('plugin-state.controller, refresh', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('populates plugins + originalState + pendingState from the response', async () => {
    const items = [plugin('claude'), plugin('gemini', { status: 'disabled' })];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const handle = make(setupDeps({ listPlugins }));

    await handle.refresh();

    expect(listPlugins).toHaveBeenCalledTimes(1);
    expect(handle.plugins().map((p) => p.id)).toEqual(['claude', 'gemini']);
    expect(handle.originalState().get("claude/claude")).toBe(true);
    expect(handle.originalState().get("gemini/gemini")).toBe(false);
    expect(handle.pendingState().get("claude/claude")).toBe(true);
    expect(handle.hasPendingChanges()).toBe(false);
    expect(handle.loading()).toBe(false);
    expect(handle.loadError()).toBeNull();
  });

  it('surfaces the error message and resets state when listPlugins rejects', async () => {
    const listPlugins = vi.fn().mockRejectedValue(new Error('boom'));
    const handle = make(setupDeps({ listPlugins }));

    await handle.refresh();

    expect(handle.loadError()).toBe('boom');
    expect(handle.plugins()).toEqual([]);
    expect(handle.originalState().size).toBe(0);
    expect(handle.pendingState().size).toBe(0);
  });
});

describe('plugin-state.controller, toggle buffering', () => {
  it('toggling a plugin aggregate mutates pendingState and dirtyIds reflects it', async () => {
    const items = [plugin('claude')];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    expect(handle.dirtyIds().size).toBe(0);
    toggleBundleAggregate(handle, items[0], false);
    expect(handle.pendingState().get("claude/claude")).toBe(false);
    expect(handle.dirtyIds().has("claude/claude")).toBe(true);
    expect(handle.hasPendingChanges()).toBe(true);
    expect(handle.isDirty("claude/claude")).toBe(true);
  });

  it('toggling back to the original value clears the dirty marker', async () => {
    const items = [plugin('claude')];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    toggleBundleAggregate(handle, items[0], false);
    toggleBundleAggregate(handle, items[0], true);
    expect(handle.dirtyIds().has("claude/claude")).toBe(false);
    expect(handle.hasPendingChanges()).toBe(false);
  });

  it('onExtensionToggle keys the buffer with <plugin>/<ext>', async () => {
    const core: IPluginItemApi = {
      id: 'core',
      version: null,
      kinds: ['extractor'],
      status: 'enabled',
      reason: null,
      source: 'built-in',
      extensions: [
        { id: 'superseded', kind: 'extractor', version: '1.0.0', enabled: true },
      ],
    };
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope([core])) }),
    );
    await handle.refresh();

    handle.onExtensionToggle('core', core.extensions![0], false);
    expect(handle.pendingState().get('core/superseded')).toBe(false);
    expect(handle.dirtyIds().has('core/superseded')).toBe(true);
  });
});

describe('plugin-state.controller, applyChanges', () => {
  it('ships only the dirty diff, refreshes state, fires a scan, and returns ok=true', async () => {
    const before = [plugin('claude'), plugin('gemini')];
    const after = [plugin('claude', { status: 'disabled' }), plugin('gemini')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(before));
    const applyPluginChanges = vi.fn().mockResolvedValue(pluginsEnvelope(after));
    const deps = setupDeps({ listPlugins, applyPluginChanges });
    const handle = make(deps);
    await handle.refresh();

    toggleBundleAggregate(handle, before[0], false);
    const result = await handle.applyChanges();

    expect(result.ok).toBe(true);
    expect(applyPluginChanges).toHaveBeenCalledTimes(1);
    expect(applyPluginChanges).toHaveBeenCalledWith([
      { id: 'claude/claude', enabled: false },
    ]);
    expect(deps.scanRun).toHaveBeenCalledTimes(1);
    expect(handle.hasPendingChanges()).toBe(false);
    expect(handle.originalState().get("claude/claude")).toBe(false);
  });

  it('returns ok=false with no dirty entries and does not call the data source', async () => {
    const items = [plugin('claude')];
    const applyPluginChanges = vi.fn();
    const deps = setupDeps({
      listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)),
      applyPluginChanges,
    });
    const handle = make(deps);
    await handle.refresh();

    const result = await handle.applyChanges();
    expect(result.ok).toBe(false);
    expect(applyPluginChanges).not.toHaveBeenCalled();
    expect(deps.scanRun).not.toHaveBeenCalled();
  });

  it('returns ok=false and surfaces the error when applyPluginChanges rejects', async () => {
    const items = [plugin('claude')];
    const applyPluginChanges = vi.fn().mockRejectedValue(new Error('boom'));
    const deps = setupDeps({
      listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)),
      applyPluginChanges,
    });
    const handle = make(deps);
    await handle.refresh();

    toggleBundleAggregate(handle, items[0], false);
    const result = await handle.applyChanges();

    expect(result.ok).toBe(false);
    expect(handle.toggleError()).toBe('boom');
    // Buffer stays dirty so the user can retry or discard.
    expect(handle.hasPendingChanges()).toBe(true);
    expect(deps.scanRun).not.toHaveBeenCalled();
  });
});

describe('plugin-state.controller, discardChanges', () => {
  it('resets pendingState to originalState and clears toggleError', async () => {
    const items = [plugin('claude')];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    toggleBundleAggregate(handle, items[0], false);
    expect(handle.hasPendingChanges()).toBe(true);

    handle.discardChanges();
    expect(handle.hasPendingChanges()).toBe(false);
    expect(handle.pendingState().get("claude/claude")).toBe(true);
  });
});

/**
 * Build a single-extension plugin whose extension declares settings. The
 * extension id equals the plugin id (mirrors `openai/openai`), so the
 * qualified buffer key is `<id>/<id>`.
 */
function pluginWithSettings(
  id: string,
  settings: IPluginExtensionApi['settings'],
  settingValues?: Record<string, unknown>,
  secretSettingsSet?: string[],
): IPluginItemApi {
  return {
    id,
    version: '1.0.0',
    kinds: ['extractor'],
    status: 'enabled',
    reason: null,
    source: 'built-in',
    extensions: [
      {
        id,
        kind: 'extractor',
        version: '1.0.0',
        enabled: true,
        settings,
        ...(settingValues ? { settingValues } : {}),
        ...(secretSettingsSet ? { secretSettingsSet } : {}),
      },
    ],
  };
}

describe('plugin-state.controller, settings buffering', () => {
  it('seeds pendingSettings from settingValues / defaults and tracks dirtiness', async () => {
    const items = [
      pluginWithSettings(
        'beacon',
        [
          { id: 'name', type: 'single-string', label: 'Name', default: 'a' },
          { id: 'limit', type: 'integer', label: 'Limit' },
        ],
        { name: 'configured' },
      ),
    ];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    expect(handle.pendingSettingValue('beacon/beacon', 'name')).toBe('configured');
    expect(handle.dirtyIds().size).toBe(0);

    handle.onSettingChange('beacon', 'beacon', 'name', 'edited');
    expect(handle.pendingSettingValue('beacon/beacon', 'name')).toBe('edited');
    expect(handle.dirtyIds().has('beacon/beacon')).toBe(true);
    expect(handle.hasPendingChanges()).toBe(true);

    // Editing back to the original clears the marker.
    handle.onSettingChange('beacon', 'beacon', 'name', 'configured');
    expect(handle.dirtyIds().has('beacon/beacon')).toBe(false);
  });

  it('ships only the changed settings keys in the bulk patch', async () => {
    const items = [
      pluginWithSettings(
        'beacon',
        [
          { id: 'name', type: 'single-string', label: 'Name', default: 'a' },
          { id: 'tag', type: 'single-string', label: 'Tag', default: 'b' },
        ],
        { name: 'a', tag: 'b' },
      ),
    ];
    const applyPluginChanges = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const deps = setupDeps({
      listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)),
      applyPluginChanges,
    });
    const handle = make(deps);
    await handle.refresh();

    handle.onSettingChange('beacon', 'beacon', 'name', 'changed');
    const result = await handle.applyChanges();

    expect(result.ok).toBe(true);
    expect(applyPluginChanges).toHaveBeenCalledWith([
      { id: 'beacon/beacon', settings: { name: 'changed' } },
    ]);
    expect(deps.scanRun).toHaveBeenCalledTimes(1);
  });

  it('combines a toggle and a settings edit into one change for the same row', async () => {
    const items = [
      pluginWithSettings(
        'beacon',
        [{ id: 'name', type: 'single-string', label: 'Name', default: 'a' }],
        { name: 'a' },
      ),
    ];
    const applyPluginChanges = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const handle = make(
      setupDeps({
        listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)),
        applyPluginChanges,
      }),
    );
    await handle.refresh();

    handle.onExtensionToggle('beacon', items[0].extensions![0], false);
    handle.onSettingChange('beacon', 'beacon', 'name', 'changed');
    await handle.applyChanges();

    expect(applyPluginChanges).toHaveBeenCalledWith([
      { id: 'beacon/beacon', enabled: false, settings: { name: 'changed' } },
    ]);
  });

  it('treats a blank secret as unchanged and a typed secret as a change', async () => {
    const items = [
      pluginWithSettings(
        'beacon',
        [{ id: 'tok', type: 'secret', label: 'Token' }],
        {},
        ['tok'],
      ),
    ];
    const applyPluginChanges = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const handle = make(
      setupDeps({
        listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)),
        applyPluginChanges,
      }),
    );
    await handle.refresh();

    // Secret opens blank; no dirty marker yet even though it is "set".
    expect(handle.pendingSettingValue('beacon/beacon', 'tok')).toBe('');
    expect(handle.dirtyIds().has('beacon/beacon')).toBe(false);

    handle.onSettingChange('beacon', 'beacon', 'tok', 'new-secret');
    expect(handle.dirtyIds().has('beacon/beacon')).toBe(true);
    await handle.applyChanges();

    expect(applyPluginChanges).toHaveBeenCalledWith([
      { id: 'beacon/beacon', settings: { tok: 'new-secret' } },
    ]);
  });

  it('discardChanges reverts buffered settings edits', async () => {
    const items = [
      pluginWithSettings(
        'beacon',
        [{ id: 'name', type: 'single-string', label: 'Name', default: 'a' }],
        { name: 'a' },
      ),
    ];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    handle.onSettingChange('beacon', 'beacon', 'name', 'changed');
    expect(handle.hasPendingChanges()).toBe(true);

    handle.discardChanges();
    expect(handle.hasPendingChanges()).toBe(false);
    expect(handle.pendingSettingValue('beacon/beacon', 'name')).toBe('a');
  });
});

describe('plugin-state.controller, restartRecommended', () => {
  it('is true when a startsAsDisabled plugin is re-enabled in the buffer', async () => {
    const items = [
      plugin('was-off', { status: 'disabled', startsAsDisabled: true }),
      plugin('claude'),
    ];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    expect(handle.restartRecommended()).toBe(false);

    toggleBundleAggregate(handle, items[0], true);
    expect(handle.restartRecommended()).toBe(true);
  });

  it('is false when only non-startsAsDisabled plugins are dirty', async () => {
    const items = [plugin('claude')];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    toggleBundleAggregate(handle, items[0], false);
    expect(handle.restartRecommended()).toBe(false);
  });
});
