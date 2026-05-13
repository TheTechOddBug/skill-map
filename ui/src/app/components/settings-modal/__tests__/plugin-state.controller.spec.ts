import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { setupPluginState } from '../plugin-state.controller';
import type {
  IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import type {
  IListEnvelopeApi,
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

function bundle(
  id: string,
  overrides: Partial<IPluginItemApi> = {},
): IPluginItemApi {
  return {
    id,
    version: '1.0.0',
    kinds: ['provider'],
    status: 'enabled',
    reason: null,
    source: 'built-in',
    granularity: 'bundle',
    ...overrides,
  };
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
    const items = [bundle('claude'), bundle('gemini', { status: 'disabled' })];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const handle = make(setupDeps({ listPlugins }));

    await handle.refresh();

    expect(listPlugins).toHaveBeenCalledTimes(1);
    expect(handle.plugins().map((p) => p.id)).toEqual(['claude', 'gemini']);
    expect(handle.originalState().get('claude')).toBe(true);
    expect(handle.originalState().get('gemini')).toBe(false);
    expect(handle.pendingState().get('claude')).toBe(true);
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
  it('onBundleToggle mutates pendingState and dirtyIds reflects it', async () => {
    const items = [bundle('claude')];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    expect(handle.dirtyIds().size).toBe(0);
    handle.onBundleToggle(items[0], false);
    expect(handle.pendingState().get('claude')).toBe(false);
    expect(handle.dirtyIds().has('claude')).toBe(true);
    expect(handle.hasPendingChanges()).toBe(true);
    expect(handle.isDirty('claude')).toBe(true);
  });

  it('toggling back to the original value clears the dirty marker', async () => {
    const items = [bundle('claude')];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    handle.onBundleToggle(items[0], false);
    handle.onBundleToggle(items[0], true);
    expect(handle.dirtyIds().has('claude')).toBe(false);
    expect(handle.hasPendingChanges()).toBe(false);
  });

  it('onExtensionToggle keys the buffer with <bundle>/<ext>', async () => {
    const core: IPluginItemApi = {
      id: 'core',
      version: null,
      kinds: ['extractor'],
      status: 'enabled',
      reason: null,
      source: 'built-in',
      granularity: 'extension',
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
    const before = [bundle('claude'), bundle('gemini')];
    const after = [bundle('claude', { status: 'disabled' }), bundle('gemini')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(before));
    const applyPluginChanges = vi.fn().mockResolvedValue(pluginsEnvelope(after));
    const deps = setupDeps({ listPlugins, applyPluginChanges });
    const handle = make(deps);
    await handle.refresh();

    handle.onBundleToggle(before[0], false);
    const result = await handle.applyChanges();

    expect(result.ok).toBe(true);
    expect(applyPluginChanges).toHaveBeenCalledTimes(1);
    expect(applyPluginChanges).toHaveBeenCalledWith([
      { id: 'claude', enabled: false },
    ]);
    expect(deps.scanRun).toHaveBeenCalledTimes(1);
    expect(handle.hasPendingChanges()).toBe(false);
    expect(handle.originalState().get('claude')).toBe(false);
  });

  it('returns ok=false with no dirty entries and does not call the data source', async () => {
    const items = [bundle('claude')];
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
    const items = [bundle('claude')];
    const applyPluginChanges = vi.fn().mockRejectedValue(new Error('boom'));
    const deps = setupDeps({
      listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)),
      applyPluginChanges,
    });
    const handle = make(deps);
    await handle.refresh();

    handle.onBundleToggle(items[0], false);
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
    const items = [bundle('claude')];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    handle.onBundleToggle(items[0], false);
    expect(handle.hasPendingChanges()).toBe(true);

    handle.discardChanges();
    expect(handle.hasPendingChanges()).toBe(false);
    expect(handle.pendingState().get('claude')).toBe(true);
  });
});

describe('plugin-state.controller, restartRecommended', () => {
  it('is true when a startsAsDisabled plugin is re-enabled in the buffer', async () => {
    const items = [
      bundle('was-off', { status: 'disabled', startsAsDisabled: true }),
      bundle('claude'),
    ];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    expect(handle.restartRecommended()).toBe(false);

    handle.onBundleToggle(items[0], true);
    expect(handle.restartRecommended()).toBe(true);
  });

  it('is false when only non-startsAsDisabled plugins are dirty', async () => {
    const items = [bundle('claude')];
    const handle = make(
      setupDeps({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) }),
    );
    await handle.refresh();

    handle.onBundleToggle(items[0], false);
    expect(handle.restartRecommended()).toBe(false);
  });
});
