import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SettingsPluginSection } from '../settings-plugin-section';
import { pluginHasSettings } from '../settings-plugin-section.controller';
import { SettingsBufferService } from '../settings-buffer';
import { ScanTriggerService } from '../../../services/scan-trigger';
import {
  DATA_SOURCE,
  type IDataSourcePort,
  type IPluginChange,
} from '../../../../services/data-source/data-source.port';
import type {
  IPluginExtensionApi,
  IPluginExtensionSettingApi,
  IPluginItemApi,
} from '../../../../models/api';

/**
 * SettingsPluginSection, the per-plugin settings section. Coverage:
 *   - renders the plugin id title + one subtitle per settings-declaring
 *     extension + a control per declared setting.
 *   - only settings-declaring extensions appear (no empty entries).
 *   - buffers edits locally and registers an IBufferOwner whose
 *     collectChanges() returns `{ id: '<plugin>/<ext>', settings: {...} }`
 *     for the changed settings only (blank secret = omitted).
 */

function ext(
  id: string,
  settings?: IPluginExtensionSettingApi[],
  overrides: Partial<IPluginExtensionApi> = {},
): IPluginExtensionApi {
  return {
    id,
    kind: 'analyzer',
    version: '1.0.0',
    enabled: true,
    ...(settings ? { settings } : {}),
    ...overrides,
  };
}

function plugin(id: string, extensions: IPluginExtensionApi[]): IPluginItemApi {
  return {
    id,
    version: null,
    kinds: ['analyzer'],
    status: 'enabled',
    reason: null,
    source: 'built-in',
    extensions,
  };
}

interface ISetup {
  cmp: SettingsPluginSection;
  fixture: ReturnType<typeof TestBed.createComponent<SettingsPluginSection>>;
  buffer: SettingsBufferService;
  host: HTMLElement;
}

function bootstrap(pluginItem: IPluginItemApi): ISetup {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: {} as Partial<IDataSourcePort> },
      { provide: ScanTriggerService, useValue: { run: vi.fn() } },
    ],
  });
  const buffer = TestBed.inject(SettingsBufferService);
  const fixture = TestBed.createComponent(SettingsPluginSection);
  fixture.componentRef.setInput('plugin', pluginItem);
  fixture.detectChanges();
  return {
    cmp: fixture.componentInstance,
    fixture,
    buffer,
    host: fixture.nativeElement as HTMLElement,
  };
}

/** Reach the registered owner via the component's section handle (the
 *  owner delegates to it 1:1). */
interface IHandleProbe {
  collectChanges(): IPluginChange[];
  onSettingChange(key: string, settingId: string, next: unknown): void;
  discardChanges(): void;
}

function handleOf(cmp: SettingsPluginSection): IHandleProbe {
  return (cmp as unknown as { handleRef: IHandleProbe }).handleRef;
}

describe('pluginHasSettings, sidebar-section gate', () => {
  const opt: IPluginExtensionSettingApi = {
    id: 'opt',
    type: 'single-string',
    label: 'Opt',
  };

  it('true: enabled plugin with an enabled settings-declaring extension', () => {
    expect(pluginHasSettings(plugin('p', [ext('a', [opt])]))).toBe(true);
  });

  it('false: the plugin is disabled', () => {
    expect(
      pluginHasSettings({ ...plugin('p', [ext('a', [opt])]), status: 'disabled' }),
    ).toBe(false);
  });

  it('false: the only settings-declaring extension is disabled', () => {
    expect(
      pluginHasSettings(plugin('p', [ext('a', [opt], { enabled: false })])),
    ).toBe(false);
  });

  it('false: no enabled extension declares settings', () => {
    expect(pluginHasSettings(plugin('p', [ext('a')]))).toBe(false);
  });
});

describe('SettingsPluginSection, rendering', () => {
  it('renders the plugin id title and a subtitle per settings-declaring extension', () => {
    const item = plugin('beacon', [
      ext('alpha', [{ id: 'name', type: 'single-string', label: 'Name', default: 'a' }]),
      ext('no-settings'),
      ext('beta', [{ id: 'limit', type: 'integer', label: 'Limit' }]),
    ]);
    const { host } = bootstrap(item);

    expect(
      host.querySelector('[data-testid="settings-plugin-section-title"]')?.textContent,
    ).toContain('beacon');

    // Only the two settings-declaring extensions render; `no-settings` is
    // absent.
    expect(host.querySelector('[data-testid="settings-plugin-section-ext-beacon/alpha"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-plugin-section-ext-beacon/beta"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-plugin-section-ext-beacon/no-settings"]')).toBeNull();

    // One control per declared setting.
    expect(host.querySelector('[data-testid="settings-plugin-section-setting-beacon/alpha-name"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-plugin-section-setting-beacon/beta-limit"]')).not.toBeNull();
  });
});

describe('SettingsPluginSection, buffer owner', () => {
  it('registers with the service and reports dirty after an edit', () => {
    const item = plugin('beacon', [
      ext('alpha', [{ id: 'name', type: 'single-string', label: 'Name', default: 'a' }], {
        settingValues: { name: 'a' },
      }),
    ]);
    const { cmp, buffer } = bootstrap(item);

    expect(buffer.dirtyCount()).toBe(0);

    handleOf(cmp).onSettingChange('beacon/alpha', 'name', 'edited');
    expect(buffer.dirtyCount()).toBe(1);
  });

  it('collectChanges ships only the changed settings keys as one change per dirty extension', () => {
    const item = plugin('beacon', [
      ext(
        'alpha',
        [
          { id: 'name', type: 'single-string', label: 'Name', default: 'a' },
          { id: 'tag', type: 'single-string', label: 'Tag', default: 'b' },
        ],
        { settingValues: { name: 'a', tag: 'b' } },
      ),
    ]);
    const { cmp } = bootstrap(item);
    const handle = handleOf(cmp);

    expect(handle.collectChanges()).toEqual([]);

    handle.onSettingChange('beacon/alpha', 'name', 'changed');
    expect(handle.collectChanges()).toEqual([
      { id: 'beacon/alpha', settings: { name: 'changed' } },
    ]);
  });

  it('treats a blank secret as unchanged (omitted) and a typed secret as a change', () => {
    const item = plugin('beacon', [
      ext('alpha', [{ id: 'tok', type: 'secret', label: 'Token' }], {
        secretSettingsSet: ['tok'],
      }),
    ]);
    const { cmp } = bootstrap(item);
    const handle = handleOf(cmp);

    // Secret opens blank; nothing collected yet even though it is "set".
    expect(handle.collectChanges()).toEqual([]);

    handle.onSettingChange('beacon/alpha', 'tok', 'new-secret');
    expect(handle.collectChanges()).toEqual([
      { id: 'beacon/alpha', settings: { tok: 'new-secret' } },
    ]);
  });

  it('discardChanges reverts buffered edits', () => {
    const item = plugin('beacon', [
      ext('alpha', [{ id: 'name', type: 'single-string', label: 'Name', default: 'a' }], {
        settingValues: { name: 'a' },
      }),
    ]);
    const { cmp, buffer } = bootstrap(item);
    const handle = handleOf(cmp);

    handle.onSettingChange('beacon/alpha', 'name', 'changed');
    expect(buffer.dirtyCount()).toBe(1);

    handle.discardChanges();
    expect(buffer.dirtyCount()).toBe(0);
    expect(handle.collectChanges()).toEqual([]);
  });
});
