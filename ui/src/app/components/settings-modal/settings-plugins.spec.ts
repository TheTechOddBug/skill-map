import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SettingsPlugins } from './settings-plugins';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import type { IListEnvelopeApi, IPluginItemApi } from '../../../models/api';

/**
 * SettingsPlugins — smoke tests around the lifecycle:
 *   - `visible()` flipping to true triggers `listPlugins()`.
 *   - bundle toggle calls `setPluginEnabled` with the new value.
 *   - extension toggle calls `setPluginExtensionEnabled` with the
 *     bundle id + extension id.
 *
 * The PrimeNG dialog renders in an overlay portal that vitest's jsdom
 * can't easily inspect, so the assertions target the component's
 * imperative API + the stub call shapes rather than DOM queries.
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

function bundlePlugin(
  id: string,
  status: IPluginItemApi['status'] = 'enabled',
  description?: string,
): IPluginItemApi {
  return {
    id,
    version: '1.0.0',
    kinds: ['provider'],
    status,
    reason: null,
    source: 'built-in',
    granularity: 'bundle',
    ...(description ? { description } : {}),
  };
}

function extensionPlugin(
  id: string,
  extensions: Array<{ id: string; enabled: boolean; description?: string }>,
  bundleDescription?: string,
): IPluginItemApi {
  return {
    id,
    version: null,
    kinds: ['extractor'],
    status: 'enabled',
    reason: null,
    source: 'built-in',
    granularity: 'extension',
    ...(bundleDescription ? { description: bundleDescription } : {}),
    extensions: extensions.map((e) => ({
      id: e.id,
      kind: 'extractor',
      version: '1.0.0',
      enabled: e.enabled,
      ...(e.description ? { description: e.description } : {}),
    })),
  };
}

function bootstrap(stub: Partial<IDataSourcePort>): {
  cmp: SettingsPlugins;
  fixture: ReturnType<typeof TestBed.createComponent<SettingsPlugins>>;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: DATA_SOURCE, useValue: stub }],
  });
  const fixture = TestBed.createComponent(SettingsPlugins);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  return { cmp: fixture.componentInstance, fixture };
}

describe('SettingsPlugins — fetch on activation', () => {
  it('fetches plugins when visible flips to true', async () => {
    const items = [bundlePlugin('claude'), bundlePlugin('gemini', 'disabled')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    expect(listPlugins).not.toHaveBeenCalled();

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    // Allow the async refresh to flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(listPlugins).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsPlugins — toggle dispatch', () => {
  it('bundle toggle calls setPluginEnabled with the new value', async () => {
    const items = [bundlePlugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const setPluginEnabled = vi.fn().mockResolvedValue(
      pluginsEnvelope([bundlePlugin('claude', 'disabled')]),
    );
    const { cmp, fixture } = bootstrap({
      listPlugins,
      setPluginEnabled,
    } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    (cmp as unknown as {
      onBundleToggle(p: IPluginItemApi, v: boolean): void;
    }).onBundleToggle(items[0], false);
    await Promise.resolve();
    await Promise.resolve();

    expect(setPluginEnabled).toHaveBeenCalledWith('claude', false);
  });

  it('extension toggle calls setPluginExtensionEnabled with bundle + ext id', async () => {
    const core = extensionPlugin('core', [{ id: 'superseded', enabled: true }]);
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope([core]));
    const setPluginExtensionEnabled = vi.fn().mockResolvedValue(
      pluginsEnvelope([extensionPlugin('core', [{ id: 'superseded', enabled: false }])]),
    );
    const { cmp, fixture } = bootstrap({
      listPlugins,
      setPluginExtensionEnabled,
    } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    (cmp as unknown as {
      onExtensionToggle(
        bundleId: string,
        ext: { id: string },
        v: boolean,
      ): void;
    }).onExtensionToggle('core', { id: 'superseded' }, false);
    await Promise.resolve();
    await Promise.resolve();

    expect(setPluginExtensionEnabled).toHaveBeenCalledWith('core', 'superseded', false);
  });
});

describe('SettingsPlugins — search by description', () => {
  async function loadAndSearch(items: IPluginItemApi[], query: string) {
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    (cmp as unknown as { searchText: { set(v: string): void } }).searchText.set(query);
    fixture.detectChanges();
    return cmp as unknown as {
      filteredPlugins(): IPluginItemApi[];
      forcedExpand(): Set<string>;
    };
  }

  it('matches when the query hits the bundle description', async () => {
    const items = [
      bundlePlugin('claude', 'enabled', 'Claude Code platform integration.'),
      bundlePlugin('gemini', 'enabled', 'Gemini CLI integration.'),
    ];
    const view = await loadAndSearch(items, 'claude code');
    const ids = view.filteredPlugins().map((p) => p.id);
    assert.deepEqual(ids, ['claude']);
  });

  it('matches when the query hits an extension description', async () => {
    const items = [
      extensionPlugin(
        'core',
        [
          { id: 'superseded', enabled: true, description: 'Surfaces nodes whose annotations declare a supersededBy replacement.' },
          { id: 'broken-ref', enabled: true, description: 'Flags links whose target cannot be resolved.' },
        ],
        'Core extensions shared across providers.',
      ),
    ];
    const view = await loadAndSearch(items, 'supersededBy');
    const filtered = view.filteredPlugins();
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'core');
    const exts = filtered[0].extensions ?? [];
    assert.equal(exts.length, 1, 'expected only the matching extension to be kept');
    assert.equal(exts[0].id, 'superseded');
    // Extension-only match forces the bundle expanded so the user
    // sees the hit without an extra click.
    assert.ok(view.forcedExpand().has('core'), 'core must be forced-expanded by an ext-description hit');
  });

  it('keeps every extension when the query hits the bundle (id or description) directly', async () => {
    const items = [
      extensionPlugin(
        'core',
        [
          { id: 'superseded', enabled: true, description: 'A description.' },
          { id: 'broken-ref', enabled: true, description: 'Another description.' },
        ],
        'Core extensions shared across providers.',
      ),
    ];
    const view = await loadAndSearch(items, 'core');
    const filtered = view.filteredPlugins();
    assert.equal(filtered.length, 1);
    assert.equal((filtered[0].extensions ?? []).length, 2, 'bundle hit should pass through all extensions');
    assert.equal(view.forcedExpand().has('core'), false);
  });
});

describe('SettingsPlugins — error surface', () => {
  it('exposes the error message when listPlugins rejects', async () => {
    const listPlugins = vi.fn().mockRejectedValue(new Error('boom'));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    const protectedErr = (cmp as unknown as { loadError: { (): string | null } }).loadError();
    expect(protectedErr).toBe('boom');
  });
});
