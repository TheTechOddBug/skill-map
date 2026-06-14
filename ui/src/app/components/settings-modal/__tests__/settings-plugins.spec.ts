import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SettingsPlugins } from '../settings-plugins';
import { SettingsBufferService } from '../settings-buffer.service';
import { ScanTriggerService } from '../../../services/scan-trigger';
import {
  DATA_SOURCE,
  type IDataSourcePort,
  type IPluginChange,
} from '../../../../services/data-source/data-source.port';
import type { IListEnvelopeApi, IPluginItemApi } from '../../../../models/api';

/**
 * SettingsPlugins, coverage for the buffered-toggle flow now that the
 * panel is one of several buffered owners (operator settings moved into
 * the per-plugin sections, and the global Apply lives in the chassis):
 *   - `visible()` flipping to true triggers `listPlugins()`.
 *   - plugin / extension toggles mutate `pendingState` only, they do
 *     NOT call the data-source's single-id PATCH endpoints.
 *   - `dirtyIds` tracks the diff against `originalState`.
 *   - the registered buffer owner's `collectChanges()` projects the
 *     dirty deltas; `reseed()` clears them; `discardChanges()` reverts.
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

function plugin(
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
    // Every plugin ships at least one extension; the plugin is just a
    // presentational grouping (no toggle of its own), so the inline
    // extension carries the toggle axis tests reach into via
    // `onExtensionToggle`. Use the same id as the plugin (mirrors the
    // single-extension provider plugins like `openai/openai`).
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
 * Convenience helper: flip the plugin's first extension via
 * `onExtensionToggle`. Returns the qualified id the dirty-state tracking
 * should report against.
 */
function toggleBundleAggregate(
  cmp: SettingsPlugins,
  plugin: IPluginItemApi,
  next: boolean,
): string {
  const ext = (plugin.extensions ?? [])[0];
  if (!ext) throw new Error(`plugin ${plugin.id} has no extensions to toggle`);
  (cmp as unknown as ITogglesProtoApi).onExtensionToggle(plugin.id, ext, next);
  return `${plugin.id}/${ext.id}`;
}

function extensionPlugin(
  id: string,
  extensions: Array<{ id: string; enabled: boolean; description?: string }>,
  pluginDescription?: string,
): IPluginItemApi {
  return {
    id,
    version: null,
    kinds: ['extractor'],
    status: 'enabled',
    reason: null,
    source: 'built-in',
    ...(pluginDescription ? { description: pluginDescription } : {}),
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
  buffer: SettingsBufferService;
}

function bootstrap(stub: Partial<IDataSourcePort>): IBootstrapResult {
  TestBed.resetTestingModule();
  // SettingsPlugins persists `kindFilter` and the `collapsed` set to
  // localStorage; a stale value from a previous test would silently
  // bleed into the next bootstrap. Clearing before each TestBed instance
  // gives every spec a clean slate.
  try {
    localStorage.clear();
  } catch {
    // jsdom should always have localStorage; guard defensively.
  }
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
      // Stub the scan trigger so injecting the real SettingsBufferService
      // does not pull the CollectionLoader / WS chain (whose
      // `dataSource.events()` is not on these stubs) into construction.
      {
        provide: ScanTriggerService,
        useValue: { run: vi.fn().mockResolvedValue(undefined), scanning: () => false, scanError: () => null },
      },
    ],
  });
  const buffer = TestBed.inject(SettingsBufferService);
  const fixture = TestBed.createComponent(SettingsPlugins);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  return { cmp: fixture.componentInstance, fixture, buffer };
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
    pluginId: string,
    ext: { id: string },
    v: boolean,
  ): void;
}

describe('SettingsPlugins, fetch on activation', () => {
  it('fetches plugins when visible flips to true', async () => {
    const items = [plugin('claude'), plugin('gemini', 'disabled')];
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
  it('plugin toggle mutates pendingState only, no PATCH fires', async () => {
    const items = [plugin('claude')];
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
    const items = [plugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    toggleBundleAggregate(cmp, items[0], false);
    expect(cmp.dirtyIds().has('claude/claude')).toBe(true);
    toggleBundleAggregate(cmp, items[0], true);
    expect(cmp.dirtyIds().has('claude/claude')).toBe(false);
    expect(cmp.hasPendingChanges()).toBe(false);
  });
});

describe('SettingsPlugins, buffer-owner registration', () => {
  it('registers an owner whose collectChanges projects the dirty toggle deltas', async () => {
    const items = [plugin('claude'), plugin('gemini')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture, buffer } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    // The chassis-facing service sees the owner's dirty count.
    expect(buffer.dirtyCount()).toBe(0);

    toggleBundleAggregate(cmp, items[0], false);
    // gemini stays unchanged, only claude/claude is collected.
    expect(buffer.dirtyCount()).toBe(1);
    expect(collectViaOwner(cmp)).toEqual([
      { id: 'claude/claude', enabled: false },
    ]);
  });

  it('reseed via the owner clears the dirty markers from a post-write list', async () => {
    const before = [plugin('claude')];
    const after = [plugin('claude', 'disabled')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(before));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    toggleBundleAggregate(cmp, before[0], false);
    expect(cmp.hasPendingChanges()).toBe(true);

    reseedViaOwner(cmp, after);
    expect(cmp.hasPendingChanges()).toBe(false);
  });

  it('discardChanges via the owner reverts pending toggles', async () => {
    const items = [plugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    toggleBundleAggregate(cmp, items[0], false);
    expect(cmp.hasPendingChanges()).toBe(true);

    discardViaOwner(cmp);
    expect(cmp.hasPendingChanges()).toBe(false);
  });
});

/**
 * Reach into the registered buffer owner. The component registers it on
 * the service on construction; rather than mock the whole service we read
 * back its captured contract through the private field exposed by the
 * test cast (the public surface is the owner, not these methods).
 */
interface IOwnerProbe {
  collectChanges(): IPluginChange[];
  reseed(plugins: IPluginItemApi[]): void;
  discardChanges(): void;
}

function ownerOf(cmp: SettingsPlugins): IOwnerProbe {
  // The component wires the owner from its `pluginState` handle; the
  // handle's methods are the same the owner delegates to, so probing the
  // handle is equivalent to probing the owner the service holds.
  const state = (cmp as unknown as { pluginState: IOwnerProbe }).pluginState;
  return state;
}

function collectViaOwner(cmp: SettingsPlugins): IPluginChange[] {
  return ownerOf(cmp).collectChanges();
}

function reseedViaOwner(cmp: SettingsPlugins, plugins: IPluginItemApi[]): void {
  ownerOf(cmp).reseed(plugins);
}

function discardViaOwner(cmp: SettingsPlugins): void {
  ownerOf(cmp).discardChanges();
}

describe('SettingsPlugins, chevron honours user choice over filter forcing', () => {
  it('toggleExpanded collapses a granularity=extension plugin even with an active kind filter', async () => {
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
    view.kindFilter.set('analyzer');
    fixture.detectChanges();
    expect(view.isExpanded('core')).toBe(true);

    view.toggleExpanded('core');
    fixture.detectChanges();
    expect(view.isExpanded('core')).toBe(false);

    view.toggleExpanded('core');
    fixture.detectChanges();
    expect(view.isExpanded('core')).toBe(true);
  });
});

describe('SettingsPlugins, startsAsDisabled per-row hint', () => {
  it('returns true only when a startsAsDisabled plugin is being re-enabled', async () => {
    const items = [
      plugin('was-off', 'disabled', undefined, { startsAsDisabled: true }),
      plugin('claude'),
    ];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    const hint = cmp as unknown as {
      showStartsAsDisabledHint(p: IPluginItemApi): boolean;
    };

    expect(hint.showStartsAsDisabledHint(items[0])).toBe(false);

    toggleBundleAggregate(cmp, items[0], true);
    expect(hint.showStartsAsDisabledHint(items[0])).toBe(true);

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

  it('matches when the query hits the plugin description', async () => {
    const items = [
      plugin('claude', 'enabled', 'Claude Code platform integration.'),
      plugin('gemini', 'enabled', 'Gemini CLI integration.'),
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

  it('keeps every extension when the query hits the plugin (id or description) directly', async () => {
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

describe('SettingsPlugins, runtime contribution errors', () => {
  it('shows the warning badge only when runtimeContributionErrors is present', async () => {
    const withErrors = plugin('beacon', 'enabled', undefined, {
      runtimeContributionErrors: [
        {
          extensionId: 'beacon/beacon-analyzer',
          nodePath: 'docs/a.md',
          reason: 'undeclared-contribution-ref',
          message: 'Emitted contribution against an undeclared slot ref.',
          slot: 'inspector.body',
          contributionId: 'beacon-summary',
        },
      ],
    });
    const clean = plugin('claude');
    const listPlugins = vi
      .fn()
      .mockResolvedValue(pluginsEnvelope([withErrors, clean]));
    const { fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const badge = host.querySelector(
      '[data-testid="settings-row-runtime-errors-beacon"]',
    );
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('1 runtime error');

    expect(
      host.querySelector('[data-testid="settings-row-runtime-errors-claude"]'),
    ).toBeNull();
  });

  it('expands the diagnostics list on toggle (collapsed by default)', async () => {
    const withErrors = plugin('beacon', 'enabled', undefined, {
      runtimeContributionErrors: [
        {
          extensionId: 'beacon/beacon-analyzer',
          nodePath: 'docs/a.md',
          reason: 'undeclared-contribution-ref',
          message: 'Emitted contribution against an undeclared slot ref.',
          slot: 'inspector.body',
        },
      ],
    });
    const listPlugins = vi
      .fn()
      .mockResolvedValue(pluginsEnvelope([withErrors]));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('[data-testid="settings-runtime-errors-beacon"]'),
    ).toBeNull();

    const expand = cmp as unknown as { toggleRuntimeErrors(id: string): void };
    expand.toggleRuntimeErrors('beacon');
    fixture.detectChanges();

    const list = host.querySelector(
      '[data-testid="settings-runtime-errors-beacon"]',
    );
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain(
      'Emitted contribution against an undeclared slot ref.',
    );
    expect(list?.textContent).toContain('beacon/beacon-analyzer');
    expect(list?.textContent).toContain('inspector.body');
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
});
