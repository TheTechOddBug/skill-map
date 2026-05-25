import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SettingsPlugins } from '../settings-plugins';
import { ScanTriggerService } from '../../../services/scan-trigger';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import type { IListEnvelopeApi, IPluginItemApi } from '../../../../models/api';

/**
 * SettingsPlugins, coverage for the buffered-edit flow:
 *   - `visible()` flipping to true triggers `listPlugins()`.
 *   - bundle / extension toggles mutate `pendingState` only, they do
 *     NOT call the data-source's single-id PATCH endpoints.
 *   - `dirtyIds` tracks the diff against `originalState`.
 *   - `applyChanges()` ships the bulk PATCH and triggers a scan.
 *   - `discardChanges()` resets pending back to the original snapshot.
 *   - `startsAsDisabled` rows surface the per-row hint when the user
 *     re-enables them in the buffer.
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
  extras: Partial<IPluginItemApi> = {},
): IPluginItemApi {
  return {
    id,
    version: '1.0.0',
    kinds: ['provider'],
    status,
    reason: null,
    source: 'built-in',
    // Every bundle ships at least one extension; the bundle is just a
    // presentational grouping (no toggle of its own), so the inline
    // extension carries the toggle axis tests reach into via
    // `onExtensionToggle`. Use the same id as the bundle (mirrors the
    // single-extension provider bundles like `openai/openai`).
    extensions: [
      {
        id,
        kind: 'provider',
        version: '1.0.0',
        enabled: status === 'enabled',
      },
    ],
    ...(description ? { description } : {}),
    ...extras,
  };
}

/**
 * Convenience helper: flip the bundle's first extension via
 * `onExtensionToggle`. Replaces the legacy `onBundleToggle` calls now
 * that the bundle itself has no toggle axis. Returns the qualified id
 * the dirty-state tracking should report against.
 */
function toggleBundleAggregate(
  cmp: SettingsPlugins,
  plugin: IPluginItemApi,
  next: boolean,
): string {
  const ext = (plugin.extensions ?? [])[0];
  if (!ext) throw new Error(`bundle ${plugin.id} has no extensions to toggle`);
  (cmp as unknown as ITogglesProtoApi).onExtensionToggle(plugin.id, ext, next);
  return `${plugin.id}/${ext.id}`;
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

interface IBootstrapResult {
  cmp: SettingsPlugins;
  fixture: ReturnType<typeof TestBed.createComponent<SettingsPlugins>>;
  scanRun: ReturnType<typeof vi.fn>;
}

function bootstrap(stub: Partial<IDataSourcePort>): IBootstrapResult {
  TestBed.resetTestingModule();
  // SettingsPlugins persists `kindFilter` and the `collapsed` set to
  // localStorage; a stale value from a previous test would silently
  // bleed into the next bootstrap and cause filters to look mis-
  // behaved (e.g. `kindFilter='analyzer'` would hide every
  // granularity=bundle row with `kinds: ['provider']`). Clearing
  // before each TestBed instance gives every spec a clean slate.
  try {
    localStorage.clear();
  } catch {
    // jsdom should always have localStorage; guard defensively.
  }
  const scanRun = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
      { provide: ScanTriggerService, useValue: { run: scanRun, scanning: () => false, scanError: () => null } },
    ],
  });
  const fixture = TestBed.createComponent(SettingsPlugins);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  return { cmp: fixture.componentInstance, fixture, scanRun };
}

// Convenience: hop through two microtasks so the `effect` that calls
// `refresh()` resolves and `originalState` / `pendingState` are
// populated before assertions.
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface ITogglesProtoApi {
  onExtensionToggle(
    bundleId: string,
    ext: { id: string },
    v: boolean,
  ): void;
}

describe('SettingsPlugins, fetch on activation', () => {
  it('fetches plugins when visible flips to true', async () => {
    const items = [bundlePlugin('claude'), bundlePlugin('gemini', 'disabled')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    expect(listPlugins).not.toHaveBeenCalled();

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    expect(listPlugins).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsPlugins, buffered toggle dispatch', () => {
  it('bundle toggle mutates pendingState only, no PATCH fires', async () => {
    const items = [bundlePlugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const setPluginEnabled = vi.fn();
    const applyPluginChanges = vi.fn();
    const { cmp, fixture } = bootstrap({
      listPlugins,
      setPluginEnabled,
      applyPluginChanges,
    } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    toggleBundleAggregate(cmp, items[0], false);
    await flushAsync();

    expect(setPluginEnabled).not.toHaveBeenCalled();
    expect(applyPluginChanges).not.toHaveBeenCalled();
    expect(cmp.dirtyIds().has('claude/claude')).toBe(true);
    expect(cmp.hasPendingChanges()).toBe(true);
  });

  it('extension toggle mutates pendingState only, no PATCH fires', async () => {
    const core = extensionPlugin('core', [{ id: 'superseded', enabled: true }]);
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope([core]));
    const setPluginExtensionEnabled = vi.fn();
    const applyPluginChanges = vi.fn();
    const { cmp, fixture } = bootstrap({
      listPlugins,
      setPluginExtensionEnabled,
      applyPluginChanges,
    } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    (cmp as unknown as ITogglesProtoApi).onExtensionToggle(
      'core',
      { id: 'superseded' },
      false,
    );
    await flushAsync();

    expect(setPluginExtensionEnabled).not.toHaveBeenCalled();
    expect(applyPluginChanges).not.toHaveBeenCalled();
    expect(cmp.dirtyIds().has('core/superseded')).toBe(true);
  });

  it('toggling back to the original value clears the dirty marker', async () => {
    const items = [bundlePlugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    const toggles = cmp as unknown as ITogglesProtoApi;
    toggleBundleAggregate(cmp, items[0], false);
    expect(cmp.dirtyIds().has('claude/claude')).toBe(true);
    toggleBundleAggregate(cmp, items[0], true);
    expect(cmp.dirtyIds().has('claude/claude')).toBe(false);
    expect(cmp.hasPendingChanges()).toBe(false);
  });
});

describe('SettingsPlugins, applyChanges', () => {
  it('ships only the dirty entries in one bulk PATCH and triggers a scan', async () => {
    const items = [
      bundlePlugin('claude'),
      bundlePlugin('gemini'),
    ];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const applyPluginChanges = vi.fn().mockResolvedValue(
      pluginsEnvelope([bundlePlugin('claude', 'disabled'), bundlePlugin('gemini')]),
    );
    const { cmp, fixture, scanRun } = bootstrap({
      listPlugins,
      applyPluginChanges,
    } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    toggleBundleAggregate(cmp, items[0], false);
    // gemini stays at its original value, should NOT be in the diff.
    await cmp.applyChanges();

    expect(applyPluginChanges).toHaveBeenCalledTimes(1);
    // Bulk PATCH now ships qualified `<bundle>/<ext>` ids (the toggle
    // axis lives on the extension, not the bundle).
    expect(applyPluginChanges).toHaveBeenCalledWith([
      { id: 'claude/claude', enabled: false },
    ]);
    expect(scanRun).toHaveBeenCalledTimes(1);
    // Post-apply, dirty is cleared (originalState == pendingState).
    expect(cmp.hasPendingChanges()).toBe(false);
  });

  it('does nothing when there are no dirty entries', async () => {
    const items = [bundlePlugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const applyPluginChanges = vi.fn();
    const { cmp, fixture, scanRun } = bootstrap({
      listPlugins,
      applyPluginChanges,
    } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    await cmp.applyChanges();

    expect(applyPluginChanges).not.toHaveBeenCalled();
    expect(scanRun).not.toHaveBeenCalled();
  });

  it('emits the `applied` output exactly once on a successful apply', async () => {
    const items = [bundlePlugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const applyPluginChanges = vi.fn().mockResolvedValue(
      pluginsEnvelope([bundlePlugin('claude', 'disabled')]),
    );
    const { cmp, fixture } = bootstrap({
      listPlugins,
      applyPluginChanges,
    } as Partial<IDataSourcePort>);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    const appliedSpy = vi.fn();
    cmp.applied.subscribe(appliedSpy);

    toggleBundleAggregate(cmp, items[0], false);
    await cmp.applyChanges();

    expect(appliedSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT emit `applied` when applyChanges fails (modal stays open)', async () => {
    const items = [bundlePlugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const applyPluginChanges = vi.fn().mockRejectedValue(new Error('boom'));
    const { cmp, fixture } = bootstrap({
      listPlugins,
      applyPluginChanges,
    } as Partial<IDataSourcePort>);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    const appliedSpy = vi.fn();
    cmp.applied.subscribe(appliedSpy);

    toggleBundleAggregate(cmp, items[0], false);
    await cmp.applyChanges();

    expect(appliedSpy).not.toHaveBeenCalled();
    // Buffer stays dirty so the user can retry or discard.
    expect(cmp.hasPendingChanges()).toBe(true);
  });
});

describe('SettingsPlugins, restartRecommended footer hint', () => {
  it('is true when a dirty row is re-enabling a startsAsDisabled plugin', async () => {
    const items = [
      bundlePlugin('was-off', 'disabled', undefined, { startsAsDisabled: true }),
      bundlePlugin('claude'),
    ];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    // No dirty rows yet, the hint is silent.
    expect(
      (cmp as unknown as { restartRecommended(): boolean }).restartRecommended(),
    ).toBe(false);

    // Toggle the startsAsDisabled plugin back on, hint fires.
    toggleBundleAggregate(cmp, items[0], true);
    expect(
      (cmp as unknown as { restartRecommended(): boolean }).restartRecommended(),
    ).toBe(true);
  });

  it('is false when only non-startsAsDisabled plugins are dirty', async () => {
    const items = [bundlePlugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    toggleBundleAggregate(cmp, items[0], false);
    expect(cmp.hasPendingChanges()).toBe(true);
    expect(
      (cmp as unknown as { restartRecommended(): boolean }).restartRecommended(),
    ).toBe(false);
  });
});

describe('SettingsPlugins, chevron honours user choice over filter forcing', () => {
  it('toggleExpanded collapses a granularity=extension bundle even with an active kind filter', async () => {
    // Regression for the bug where `forcedExpand` overrode `collapsed`
    // while a filter was active, the chevron looked unresponsive
    // because the row stayed visually expanded after the click.
    const items = [
      extensionPlugin(
        'core',
        [
          { id: 'superseded', enabled: true, description: 'rule' },
          { id: 'broken-ref', enabled: true, description: 'rule' },
        ],
        'Core extensions.',
      ),
    ];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    type IExpand = {
      kindFilter: { set(v: string): void };
      isExpanded(id: string): boolean;
      toggleExpanded(id: string): void;
    };
    const view = cmp as unknown as IExpand;
    // Activate a kind filter so the old code path's forcedExpand would
    // have kicked in.
    view.kindFilter.set('analyzer');
    fixture.detectChanges();
    // Default for granularity=extension bundles is expanded.
    expect(view.isExpanded('core')).toBe(true);

    // Click the chevron, user wants to collapse.
    view.toggleExpanded('core');
    fixture.detectChanges();
    expect(view.isExpanded('core')).toBe(false);

    // Click again, user wants to expand.
    view.toggleExpanded('core');
    fixture.detectChanges();
    expect(view.isExpanded('core')).toBe(true);
  });
});

describe('SettingsPlugins, discardChanges', () => {
  it('resets pendingState to originalState without calling the data-source', async () => {
    const items = [bundlePlugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const applyPluginChanges = vi.fn();
    const { cmp, fixture, scanRun } = bootstrap({
      listPlugins,
      applyPluginChanges,
    } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    toggleBundleAggregate(cmp, items[0], false);
    expect(cmp.hasPendingChanges()).toBe(true);

    cmp.discardChanges();

    expect(cmp.hasPendingChanges()).toBe(false);
    expect(applyPluginChanges).not.toHaveBeenCalled();
    expect(scanRun).not.toHaveBeenCalled();
  });
});

describe('SettingsPlugins, startsAsDisabled per-row hint', () => {
  it('returns true only when a startsAsDisabled plugin is being re-enabled', async () => {
    const items = [
      bundlePlugin('was-off', 'disabled', undefined, { startsAsDisabled: true }),
      bundlePlugin('claude'),
    ];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    const hint = cmp as unknown as {
      showStartsAsDisabledHint(p: IPluginItemApi): boolean;
    };

    // Initial state: was-off is still off in the buffer, no hint.
    expect(hint.showStartsAsDisabledHint(items[0])).toBe(false);

    // Toggle was-off → on (re-enable). Hint should fire.
    toggleBundleAggregate(cmp, items[0], true);
    expect(hint.showStartsAsDisabledHint(items[0])).toBe(true);

    // claude has no startsAsDisabled flag at any toggle state.
    expect(hint.showStartsAsDisabledHint(items[1])).toBe(false);
  });
});

describe('SettingsPlugins, search by description', () => {
  async function loadAndSearch(items: IPluginItemApi[], query: string) {
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    (cmp as unknown as { searchText: { set(v: string): void } }).searchText.set(query);
    fixture.detectChanges();
    return cmp as unknown as {
      filteredPlugins(): IPluginItemApi[];
    };
  }

  it('matches when the query hits the bundle description', async () => {
    const items = [
      bundlePlugin('claude', 'enabled', 'Claude Code platform integration.'),
      bundlePlugin('gemini', 'enabled', 'Gemini CLI integration.'),
    ];
    const view = await loadAndSearch(items, 'claude code');
    const ids = view.filteredPlugins().map((p) => p.id);
    expect(ids).toEqual(['claude']);
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
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('core');
    const exts = filtered[0].extensions ?? [];
    expect(exts.length).toBe(1);
    expect(exts[0].id).toBe('superseded');
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
    expect(filtered.length).toBe(1);
    expect((filtered[0].extensions ?? []).length).toBe(2);
  });
});

describe('SettingsPlugins, error surface', () => {
  it('exposes the error message when listPlugins rejects', async () => {
    const listPlugins = vi.fn().mockRejectedValue(new Error('boom'));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    const protectedErr = (cmp as unknown as { loadError: { (): string | null } }).loadError();
    expect(protectedErr).toBe('boom');
  });

  it('surfaces applyChanges errors via toggleError', async () => {
    const items = [bundlePlugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const applyPluginChanges = vi.fn().mockRejectedValue(new Error('apply failed'));
    const { cmp, fixture } = bootstrap({
      listPlugins,
      applyPluginChanges,
    } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    toggleBundleAggregate(cmp, items[0], false);
    await cmp.applyChanges();

    const err = (cmp as unknown as { toggleError: { (): string | null } }).toggleError();
    expect(err).toBe('apply failed');
    // The buffer remains dirty so the user can retry or discard.
    expect(cmp.hasPendingChanges()).toBe(true);
  });
});
