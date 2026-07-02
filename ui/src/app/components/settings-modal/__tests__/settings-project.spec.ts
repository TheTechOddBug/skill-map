import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmationService } from 'primeng/api';

import { SettingsProject } from '../settings-project';
import {
  DATA_SOURCE,
  DataSourceError,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { ProviderRegistryService } from '../../../../services/provider-registry';
import type {
  IActiveProviderApi,
  IProjectPreferencesApi,
  IProviderRegistryApi,
} from '../../../../models/api';

/**
 * SettingsProject · active-lens dropdown gating.
 *
 * `providerOptions` lists only LENS Providers (`isLens: true`) from the
 * `providerRegistry`, filtering out the non-gated `markdown` base (the
 * universal substrate, never a pickable lens). Among the lenses, each one
 * absent from the active-provider envelope's `selectable` set (the ids
 * enabled right now) is rendered disabled, greyed + non-selectable
 * (`optionDisabled` in the template) plus a "(disabled)" label suffix, so a
 * disabled lens stays visible but can never be picked.
 *
 * The spec drives the component's imperative surface directly (the
 * `activeProviderEnvelope` signal + the root `ProviderRegistryService`)
 * so it stays independent of the network fetch and PrimeNG's overlay
 * portal, matching the settings-general / settings-plugins specs.
 */

interface IProjectProto {
  providerOptions(): { id: string; label: string; disabled: boolean }[];
  activeProviderEnvelope: WritableSignal<IActiveProviderApi | null>;
}

const REGISTRY: IProviderRegistryApi = {
  claude: { label: 'Claude', color: '#000000', isLens: true },
  codex: { label: 'OpenAI', color: '#111111', isLens: true },
  'agent-skills': { label: 'Agent Skills', color: '#333333', isLens: true },
  // The non-gated base: present in the registry (for chip lookups) but
  // `isLens: false`, so it must never appear in the dropdown.
  markdown: { label: 'Markdown', color: '#222222', isLens: false, hideChip: true },
};

function envelope(selectable: string[]): IActiveProviderApi {
  return {
    activeProvider: 'agent-skills',
    detected: [],
    source: 'default',
    selectable,
    markerDrift: null,
  };
}

function bootstrap(): { proto: IProjectProto } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: {} as Partial<IDataSourcePort> },
    ],
  });
  const fixture = TestBed.createComponent(SettingsProject);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  TestBed.inject(ProviderRegistryService).ingest(REGISTRY);
  const proto = fixture.componentInstance as unknown as IProjectProto;
  return { proto };
}

describe('SettingsProject providerOptions', () => {
  it('greys out nothing before the envelope loads', () => {
    const { proto } = bootstrap();
    // `activeProviderEnvelope` is still null here.
    const opts = proto.providerOptions();
    expect(opts.every((o) => !o.disabled)).toBe(true);
    // The three lens Providers; the non-lens `markdown` base is filtered out.
    expect(opts).toHaveLength(3);
  });

  it('excludes the non-lens markdown base from the dropdown', () => {
    const { proto } = bootstrap();
    proto.activeProviderEnvelope.set(envelope(['claude', 'codex', 'agent-skills']));
    const ids = proto.providerOptions().map((o) => o.id);
    expect(ids).not.toContain('markdown');
    expect(ids).toEqual(expect.arrayContaining(['claude', 'codex', 'agent-skills']));
  });

  it('marks lenses absent from selectable as disabled', () => {
    const { proto } = bootstrap();
    proto.activeProviderEnvelope.set(envelope(['codex', 'agent-skills']));

    const byId = new Map(proto.providerOptions().map((o) => [o.id, o]));

    expect(byId.get('claude')?.disabled).toBe(true);
    expect(byId.get('claude')?.label).toBe('Claude (disabled)');
    expect(byId.get('codex')?.disabled).toBe(false);
    expect(byId.get('codex')?.label).toBe('OpenAI');
    expect(byId.get('agent-skills')?.disabled).toBe(false);
    expect(byId.get('agent-skills')?.label).toBe('Agent Skills');
    // The base is gone from the dropdown entirely, not greyed.
    expect(byId.has('markdown')).toBe(false);
  });

  it('keeps every lens selectable when all are enabled', () => {
    const { proto } = bootstrap();
    proto.activeProviderEnvelope.set(envelope(['claude', 'codex', 'agent-skills']));
    expect(proto.providerOptions().every((o) => !o.disabled)).toBe(true);
  });

  it('labels a not-selectable lens with the "(disabled)" suffix', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DATA_SOURCE, useValue: {} as Partial<IDataSourcePort> },
      ],
    });
    const fixture = TestBed.createComponent(SettingsProject);
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    TestBed.inject(ProviderRegistryService).ingest({
      claude: { label: 'Claude', color: '#000000', isLens: true },
      codex: { label: 'OpenAI', color: '#111111', isLens: true },
    });
    const proto = fixture.componentInstance as unknown as IProjectProto;
    // When a lens is absent from `selectable` (e.g. the operator disabled
    // it), the BFF leaves it out and the dropdown greys it with a
    // "(disabled)" suffix. Here codex is excluded to exercise that path.
    proto.activeProviderEnvelope.set(envelope(['claude']));

    const byId = new Map(proto.providerOptions().map((o) => [o.id, o]));
    expect(byId.get('codex')?.disabled).toBe(true);
    expect(byId.get('codex')?.label).toBe('OpenAI (disabled)');
    expect(byId.get('claude')?.disabled).toBe(false);
    expect(byId.get('claude')?.label).toBe('Claude');
  });
});

/**
 * SettingsProject · `pluginTrust.projectEnabled` machine-local opt-in.
 *
 * The toggle persists through `setProjectPreferences`. Turning it OFF
 * narrows the local code-execution surface (direct write). Turning it ON
 * expands it, so the BFF answers 412 `confirm-required`; the component
 * reuses the same `<p-confirmdialog>` / `ConfirmationService` mechanism as
 * `scan.referencePaths`, re-issuing the patch with `confirm: true` only
 * after the operator accepts. The spec drives the component's imperative
 * surface + the component-provided `ConfirmationService` so it stays
 * independent of the network fetch and PrimeNG's overlay portal.
 */
interface ITrustProto {
  preferences: WritableSignal<IProjectPreferencesApi | null>;
  pluginTrustEnabled(): boolean;
  onProjectTrustToggle(next: boolean): void;
}

function prefs(projectEnabled: boolean): IProjectPreferencesApi {
  return {
    allowSidecarWriters: true,
    scan: { referencePaths: [] },
    pluginTrust: { projectEnabled },
  };
}

function bootstrapTrust(stub: Partial<IDataSourcePort>): {
  fixture: ReturnType<typeof TestBed.createComponent<SettingsProject>>;
  proto: ITrustProto;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
    ],
  });
  const fixture = TestBed.createComponent(SettingsProject);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  const proto = fixture.componentInstance as unknown as ITrustProto;
  return { fixture, proto };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SettingsProject pluginTrust opt-in', () => {
  it('reads pluginTrust.projectEnabled from the loaded preferences', () => {
    const { proto } = bootstrapTrust({});
    expect(proto.pluginTrustEnabled()).toBe(false);
    proto.preferences.set(prefs(true));
    expect(proto.pluginTrustEnabled()).toBe(true);
  });

  it('turning the opt-in OFF persists directly (no confirm)', async () => {
    const setProjectPreferences = vi.fn().mockResolvedValue(prefs(false));
    const { proto } = bootstrapTrust({
      setProjectPreferences,
    } as Partial<IDataSourcePort>);

    proto.onProjectTrustToggle(false);
    await flush();

    expect(setProjectPreferences).toHaveBeenCalledWith({
      pluginTrust: { projectEnabled: false },
    });
  });

  it('turning the opt-in ON surfaces the confirm dialog and retries with confirm:true on accept', async () => {
    const setProjectPreferences = vi
      .fn()
      .mockRejectedValueOnce(new DataSourceError('confirm-required', 'needs confirm'))
      .mockResolvedValueOnce(prefs(true));
    const { fixture, proto } = bootstrapTrust({
      setProjectPreferences,
    } as Partial<IDataSourcePort>);
    const confirmation = fixture.debugElement.injector.get(ConfirmationService);
    const confirmSpy = vi
      .spyOn(confirmation, 'confirm')
      .mockReturnValue(confirmation);

    proto.onProjectTrustToggle(true);
    await flush();

    expect(setProjectPreferences).toHaveBeenNthCalledWith(1, {
      pluginTrust: { projectEnabled: true },
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    // Simulate the operator accepting the confirm dialog.
    confirmSpy.mock.calls[0][0].accept?.();
    await flush();

    expect(setProjectPreferences).toHaveBeenNthCalledWith(2, {
      pluginTrust: { projectEnabled: true },
      confirm: true,
    });
    expect(proto.pluginTrustEnabled()).toBe(true);
  });

  it('does not retry when the operator dismisses the confirm dialog', async () => {
    const setProjectPreferences = vi
      .fn()
      .mockRejectedValueOnce(new DataSourceError('confirm-required', 'needs confirm'));
    const { fixture, proto } = bootstrapTrust({
      setProjectPreferences,
    } as Partial<IDataSourcePort>);
    const confirmation = fixture.debugElement.injector.get(ConfirmationService);
    const confirmSpy = vi
      .spyOn(confirmation, 'confirm')
      .mockReturnValue(confirmation);

    proto.onProjectTrustToggle(true);
    await flush();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // The operator cancels: no retry fires and the toggle stays off.
    expect(setProjectPreferences).toHaveBeenCalledTimes(1);
    expect(proto.pluginTrustEnabled()).toBe(false);
  });
});
