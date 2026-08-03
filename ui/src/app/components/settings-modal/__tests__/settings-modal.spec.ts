import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SettingsModal, type TSettingsSection } from '../settings-modal';
import { SettingsBufferService } from '../settings-buffer';
import { ProcessingAgentReadinessService } from '../../../services/processing-agent-readiness';
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

function bootstrap(
  stub: Partial<IDataSourcePort>,
  opts: { skillUpdateAvailable?: boolean } = {},
): ISetup {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
      { provide: ScanTriggerService, useValue: { run: vi.fn().mockResolvedValue(undefined) } },
      // `<sm-settings-general>` (rendered by the chassis) injects the
      // live-channel services; demo mode keeps them socket-free.
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
      // Source of the attention dot. Stubbed to a plain getter so the
      // chassis spec never boots the real probe (WS stream + fetch).
      {
        provide: ProcessingAgentReadinessService,
        useValue: {
          skillUpdateAvailable: () => opts.skillUpdateAvailable === true,
          noteSkillStatus: vi.fn(),
        } as unknown as ProcessingAgentReadinessService,
      },
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
  activeSection: { set(v: TSettingsSection): void; (): TSettingsSection };
  activePluginItem(): IPluginItemApi | null;
  applyAndClose(): Promise<void>;
  selectSection(id: TSettingsSection): void;
}

describe('SettingsModal, dynamic plugin sections', () => {
  it('splices a plugin:<id> section for each settings-declaring plugin, between Plugins and Changelog', async () => {
    // Wire `order` stamped like the BFF does (core first in the
    // canonical presentation order, the beacon drop-in after); the SPA
    // keeps no pinned twin (kernel-agnosticism sweep 2026-07-23).
    const items = [
      { ...pluginWithSettings('beacon', [
        { id: 'name', type: 'single-string', label: 'Name' },
      ]), order: 2 },
      { ...plainPlugin('claude'), order: 1 },
      { ...pluginWithSettings('core', [
        { id: 'limit', type: 'integer', label: 'Limit' },
      ]), order: 0 },
    ];
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope(items));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    const probe = cmp as unknown as IChassisProbe;
    const ids = probe.sections().map((s) => s.id);

    // Full render order: static general/project/plugins, then the
    // dynamic plugin sections (core sorts before beacon by the wire order),
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
      { ...pluginWithSettings('beacon', [
        { id: 'name', type: 'single-string', label: 'Name' },
      ]), order: 1 },
      { ...pluginWithSettings('core', [
        { id: 'limit', type: 'integer', label: 'Limit' },
      ]), order: 0 },
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

describe('SettingsModal, last-visited section memory', () => {
  const KEY = 'sm.settings.section';

  it('remembers the visited section and lands on it on the next open', async () => {
    localStorage.removeItem(KEY);
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope([]));
    const first = bootstrap({ listPlugins } as Partial<IDataSourcePort>);
    // First-ever open: the historical default.
    expect((first.cmp as unknown as IChassisProbe).activeSection()).toBe('plugins');

    (first.cmp as unknown as IChassisProbe).selectSection('project');
    expect(localStorage.getItem(KEY)).toBe('project');

    // A fresh modal (new session) initializes on the remembered section.
    const second = bootstrap({ listPlugins } as Partial<IDataSourcePort>);
    expect((second.cmp as unknown as IChassisProbe).activeSection()).toBe('project');
    localStorage.removeItem(KEY);
  });

  it('reconciles a remembered plugin section whose plugin lost its settings', async () => {
    localStorage.setItem(KEY, 'plugin:ghost');
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope([plainPlugin('other')]));
    const { cmp, fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);
    expect((cmp as unknown as IChassisProbe).activeSection()).toBe('plugin:ghost');

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    expect((cmp as unknown as IChassisProbe).activeSection()).toBe('plugins');
    localStorage.removeItem(KEY);
  });

  it('ignores an unknown stored value', async () => {
    localStorage.setItem(KEY, 'garbage-section');
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope([]));
    const { cmp } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);
    expect((cmp as unknown as IChassisProbe).activeSection()).toBe('plugins');
    localStorage.removeItem(KEY);
  });
});

/**
 * The attention dot (user spec 2026-08-03): an outdated agent process
 * skill has to be visible from ANY section of the modal, otherwise it is
 * only discoverable by the operator who already went looking. The
 * chassis reads the app-level readiness service, so the mark is live
 * without the Project section ever having mounted. It rides the sidebar
 * row alone: the modal title carried one too at first, which put the
 * same signal twice on one screen.
 */
describe('SettingsModal attention dot', () => {
  interface IAttentionProbe {
    sections(): readonly { id: TSettingsSection; attention?: boolean }[];
  }

  it('marks the project section when a skill update is pending', () => {
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope([]));
    const { cmp } = bootstrap({ listPlugins } as Partial<IDataSourcePort>, {
      skillUpdateAvailable: true,
    });

    const probe = cmp as unknown as IAttentionProbe;
    const project = probe.sections().find((s) => s.id === 'project');
    expect(project?.attention).toBe(true);
    // Exactly one section is marked: the dot must point somewhere.
    expect(probe.sections().filter((s) => s.attention === true)).toHaveLength(1);
  });

  it('marks nothing while the skill is current', () => {
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope([]));
    const { cmp } = bootstrap({ listPlugins } as Partial<IDataSourcePort>);

    const probe = cmp as unknown as IAttentionProbe;
    expect(probe.sections().some((s) => s.attention === true)).toBe(false);
  });

  it('renders the dot on the project row and nowhere else', async () => {
    const listPlugins = vi.fn().mockResolvedValue(pluginsEnvelope([]));
    const { fixture } = bootstrap({ listPlugins } as Partial<IDataSourcePort>, {
      skillUpdateAvailable: true,
    });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    // PrimeNG renders the dialog into a portal at <body>.
    const dots = document.querySelectorAll('[data-testid="settings-nav-attention-dot"]');
    expect(dots).toHaveLength(1);
    // The title mark was dropped on purpose; nothing re-adds it.
    expect(document.querySelector('[data-testid="settings-modal-attention-dot"]')).toBeNull();
    const projectRow = document.querySelector('[data-testid="settings-nav-project"]');
    expect(projectRow?.querySelector('[data-testid="settings-nav-attention-dot"]')).not.toBeNull();
    // Colour is never the only carrier of the signal.
    expect(dots[0]?.getAttribute('aria-label')).toBeTruthy();
  });
});
