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
 * plugin-state.controller, buffered fetch / toggle state machine
 * (toggle-only since operator settings moved into the per-plugin
 * sections). Tests target the handle's imperative surface plus the
 * dirty-set computeds and the `collectChanges` / `reseed` global-Apply
 * hooks (the controller no longer issues the bulk PATCH itself).
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

function make(dataSource: Partial<IDataSourcePort>) {
  return setupPluginState({
    dataSource: dataSource as IDataSourcePort,
  });
}

describe('plugin-state.controller, refresh', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('populates plugins + originalState + pendingState from the response', async () => {
    const items = [plugin('claude'), plugin('gemini', { status: 'disabled' })];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const handle = make({ listPlugins });

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
    const handle = make({ listPlugins });

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
    const handle = make({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) });
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
    const handle = make({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) });
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
    const handle = make({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope([core])) });
    await handle.refresh();

    handle.onExtensionToggle('core', core.extensions![0], false);
    expect(handle.pendingState().get('core/superseded')).toBe(false);
    expect(handle.dirtyIds().has('core/superseded')).toBe(true);
  });
});

describe('plugin-state.controller, collectChanges', () => {
  it('projects only the dirty toggle deltas as qualified change entries', async () => {
    const items = [plugin('claude'), plugin('gemini')];
    const handle = make({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) });
    await handle.refresh();

    // Clean: nothing collected.
    expect(handle.collectChanges()).toEqual([]);

    toggleBundleAggregate(handle, items[0], false);
    // gemini stays at its original value, must NOT be in the diff.
    expect(handle.collectChanges()).toEqual([
      { id: 'claude/claude', enabled: false },
    ]);
  });
});

describe('plugin-state.controller, reseed', () => {
  it('refreshes the snapshot from a post-write list and clears dirty markers', async () => {
    const before = [plugin('claude'), plugin('gemini')];
    const after = [plugin('claude', { status: 'disabled' }), plugin('gemini')];
    const handle = make({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(before)) });
    await handle.refresh();

    toggleBundleAggregate(handle, before[0], false);
    expect(handle.hasPendingChanges()).toBe(true);

    handle.reseed(after);

    expect(handle.hasPendingChanges()).toBe(false);
    expect(handle.originalState().get('claude/claude')).toBe(false);
    expect(handle.pendingState().get('claude/claude')).toBe(false);
    expect(handle.toggleError()).toBeNull();
  });
});

describe('plugin-state.controller, discardChanges', () => {
  it('resets pendingState to originalState and clears toggleError', async () => {
    const items = [plugin('claude')];
    const handle = make({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) });
    await handle.refresh();

    toggleBundleAggregate(handle, items[0], false);
    expect(handle.hasPendingChanges()).toBe(true);

    handle.discardChanges();
    expect(handle.hasPendingChanges()).toBe(false);
    expect(handle.pendingState().get("claude/claude")).toBe(true);
  });
});

describe('plugin-state.controller, restartRecommended', () => {
  it('is true when a startsAsDisabled plugin is re-enabled in the buffer', async () => {
    const items = [
      plugin('was-off', { status: 'disabled', startsAsDisabled: true }),
      plugin('claude'),
    ];
    const handle = make({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) });
    await handle.refresh();

    expect(handle.restartRecommended()).toBe(false);

    toggleBundleAggregate(handle, items[0], true);
    expect(handle.restartRecommended()).toBe(true);
  });

  it('is false when only non-startsAsDisabled plugins are dirty', async () => {
    const items = [plugin('claude')];
    const handle = make({ listPlugins: vi.fn().mockResolvedValue(pluginsEnvelope(items)) });
    await handle.refresh();

    toggleBundleAggregate(handle, items[0], false);
    expect(handle.restartRecommended()).toBe(false);
  });
});
