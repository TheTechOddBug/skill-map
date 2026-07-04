import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SettingsModal, type TSettingsSection } from '../settings-modal';
import { SettingsBufferService } from '../settings-buffer.service';
import { ScanTriggerService } from '../../../services/scan-trigger';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import type {
  IListEnvelopeApi,
  IPluginExtensionSettingApi,
  IPluginItemApi,
} from '../../../../models/api';

/**
 * SettingsModal chassis. Coverage for the new responsibilities:
 *   - on open, it fetches the plugin list and splices one dynamic
 *     `plugin:<id>` section per plugin that declares operator settings,
 *     between the `plugins` and `changelog` static entries.
 *   - the dynamic group is bracketed by `dividerBefore` flags (first
 *     plugin section + `changelog`) only when at least one dynamic
 *     section exists.
 *   - `activePluginItem()` resolves the plugin backing a `plugin:<id>`
 *     section.
 *   - the global Apply (`applyAndClose`) delegates to
 *     `SettingsBufferService.applyChanges()` and closes only on success.
 *
 * The PrimeNG dialog renders in a body portal vitest's jsdom can't
 * easily inspect, so the assertions target the component's imperative
 * surface rather than DOM queries.
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

function pluginWithSettings(
  id: string,
  settings: IPluginExtensionSettingApi[],
): IPluginItemApi {
  return {
    id,
    version: null,
    kinds: ['analyzer'],
    status: 'enabled',
    reason: null,
    source: 'built-in',
    extensions: [
      { id, kind: 'analyzer', version: '1.0.0', enabled: true, settings },
    ],
  };
}

function plainPlugin(id: string): IPluginItemApi {
  return {
    id,
    version: null,
    kinds: ['provider'],
    status: 'enabled',
    reason: null,
    source: 'built-in',
    extensions: [{ id, kind: 'provider', version: '1.0.0', enabled: true }],
  };
}

interface ISetup {
  cmp: SettingsModal;
  fixture: ReturnType<typeof TestBed.createComponent<SettingsModal>>;
  buffer: SettingsBufferService;
}

function bootstrap(stub: Partial<IDataSourcePort>): ISetup {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
      { provide: ScanTriggerService, useValue: { run: vi.fn().mockResolvedValue(undefined) } },
      // `<sm-settings-general>` (rendered by the chassis) injects the
      // live-channel services; demo mode keeps them socket-free.
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
    ],
  });
  const buffer = TestBed.inject(SettingsBufferService);
  const fixture = TestBed.createComponent(SettingsModal);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  return { cmp: fixture.componentInstance, fixture, buffer };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface IChassisProbe {
  sections(): readonly { id: TSettingsSection; label: string; dividerBefore?: boolean }[];
  activeSection: { set(v: TSettingsSection): void };
  activePluginItem(): IPluginItemApi | null;
  applyAndClose(): Promise<void>;
}

describe('SettingsModal, dynamic plugin sections', () => {
  it('splices a plugin:<id> section for each settings-declaring plugin, between Plugins and Changelog', async () => {
    const items = [
      pluginWithSettings('beacon', [
        { id: 'name', type: 'single-string', label: 'Name' },
      ]),
      plainPlugin('claude'),
      pluginWithSettings('core', [
        { id: 'limit', type: 'integer', label: 'Limit' },
      ]),
    ];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    const probe = cmp as unknown as IChassisProbe;
    const ids = probe.sections().map((s) => s.id);

    // Full render order: static general/project/plugins, then the
    // dynamic plugin sections (core sorts before beacon by pin order),
    // then the remaining static changelog/about.
    expect(ids).toEqual([
      'general',
      'project',
      'plugins',
      'plugin:core',
      'plugin:beacon',
      'changelog',
      'about',
    ]);
    // The plain plugin (no settings) gets no section.
    expect(ids).not.toContain('plugin:claude');
  });

  it('brackets the dynamic group with dividerBefore on the first plugin section and on changelog', async () => {
    const items = [
      pluginWithSettings('beacon', [
        { id: 'name', type: 'single-string', label: 'Name' },
      ]),
      pluginWithSettings('core', [
        { id: 'limit', type: 'integer', label: 'Limit' },
      ]),
    ];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    const probe = cmp as unknown as IChassisProbe;
    const sections = probe.sections();
    const flagged = sections
      .filter((s) => s.dividerBefore === true)
      .map((s) => s.id);

    // Only the first dynamic section (plugin:core, sorted before beacon)
    // and changelog carry the divider, bracketing the group.
    expect(flagged).toEqual(['plugin:core', 'changelog']);
    expect(sections.find((s) => s.id === 'plugin:beacon')?.dividerBefore).toBeFalsy();
  });

  it('renders no dividers when no plugin declares settings', async () => {
    const items = [plainPlugin('claude')];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    const probe = cmp as unknown as IChassisProbe;
    const sections = probe.sections();

    expect(sections.map((s) => s.id)).toEqual([
      'general',
      'project',
      'plugins',
      'changelog',
      'about',
    ]);
    expect(sections.some((s) => s.dividerBefore === true)).toBe(false);
  });

  it('activePluginItem resolves the plugin backing the active plugin section', async () => {
    const items = [
      pluginWithSettings('beacon', [
        { id: 'name', type: 'single-string', label: 'Name' },
      ]),
    ];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    const probe = cmp as unknown as IChassisProbe;
    expect(probe.activePluginItem()).toBeNull(); // active is 'plugins'

    probe.activeSection.set('plugin:beacon');
    expect(probe.activePluginItem()?.id).toBe('beacon');
  });
});

describe('SettingsModal, global Apply', () => {
  it('applyAndClose delegates to the buffer service and closes on success', async () => {
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope([]));
    const { cmp, buffer } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    const applySpy = vi
      .spyOn(buffer, 'applyChanges')
      .mockResolvedValue({ ok: true });
    const closeSpy = vi.fn();
    cmp.visibleChange.subscribe(closeSpy);

    await (cmp as unknown as IChassisProbe).applyAndClose();

    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledWith(false);
  });

  it('applyAndClose keeps the modal open when the apply fails', async () => {
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope([]));
    const { cmp, buffer } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    vi.spyOn(buffer, 'applyChanges').mockResolvedValue({ ok: false });
    const closeSpy = vi.fn();
    cmp.visibleChange.subscribe(closeSpy);

    await (cmp as unknown as IChassisProbe).applyAndClose();

    expect(closeSpy).not.toHaveBeenCalled();
  });
});
