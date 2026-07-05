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
  IActivityInstallStatusApi,
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

/**
 * SettingsProject · live-activity hook button.
 *
 * One button below the lens selector: Install when the hook is absent,
 * Uninstall when present, disabled + hint for lenses without an
 * activity adapter. Both mutations first POST WITHOUT `confirm`; the
 * server-enforced 412 `confirm-required` surfaces the consent dialog
 * and accepting retries with `confirm: true` (the same flow the
 * plugin-trust opt-in uses). The spec drives the imperative surface +
 * the component-provided ConfirmationService, independent of PrimeNG's
 * overlay portal.
 */
interface IActivityProto {
  activeProviderEnvelope: WritableSignal<IActiveProviderApi | null>;
  activityStatus: WritableSignal<IActivityInstallStatusApi | null>;
  activityAnnouncement(): string | null;
  activityButtonLabel(): string;
  activityButtonDisabled(): boolean;
  activityHint(): string | null;
  onActivityHookToggle(): void;
}

function activityStatusOf(overrides: Partial<IActivityInstallStatusApi>): IActivityInstallStatusApi {
  return {
    provider: 'claude',
    supported: true,
    installed: false,
    configPath: '.claude/settings.json',
    configWired: false,
    bridgePresent: false,
    events: 5,
    ...overrides,
  };
}

function bootstrapActivity(stub: Partial<IDataSourcePort>): {
  fixture: ReturnType<typeof TestBed.createComponent<SettingsProject>>;
  proto: IActivityProto;
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
  TestBed.inject(ProviderRegistryService).ingest(REGISTRY);
  const proto = fixture.componentInstance as unknown as IActivityProto;
  proto.activeProviderEnvelope.set({
    activeProvider: 'claude',
    detected: [],
    source: 'config',
    selectable: ['claude'],
    markerDrift: null,
  });
  return { fixture, proto };
}

describe('SettingsProject activity hook button', () => {
  it('labels Install / Uninstall off the status and the lens registry label', () => {
    const { proto } = bootstrapActivity({});
    proto.activityStatus.set(activityStatusOf({ installed: false }));
    expect(proto.activityButtonLabel()).toBe('Install Claude activity hook');
    expect(proto.activityButtonDisabled()).toBe(false);
    expect(proto.activityHint()).toBe(null);

    proto.activityStatus.set(activityStatusOf({ installed: true }));
    expect(proto.activityButtonLabel()).toBe('Uninstall Claude activity hook');
  });

  it('disables with a hint for a lens without an activity hook', () => {
    const { proto } = bootstrapActivity({});
    proto.activityStatus.set(
      activityStatusOf({ provider: 'codex', supported: false, configPath: null, events: 0 }),
    );
    expect(proto.activityButtonDisabled()).toBe(true);
    expect(proto.activityHint()).not.toBe(null);
  });

  it('disables while the status is unknown', () => {
    const { proto } = bootstrapActivity({});
    proto.activityStatus.set(null);
    expect(proto.activityButtonDisabled()).toBe(true);
  });

  it('install: 412 surfaces the consent dialog, accept retries with confirm and adopts the envelope', async () => {
    const installActivityHook = vi
      .fn()
      .mockRejectedValueOnce(new DataSourceError('confirm-required', 'needs confirm'))
      .mockResolvedValueOnce(
        activityStatusOf({ installed: true, configWired: true, bridgePresent: true }),
      );
    const { fixture, proto } = bootstrapActivity({
      installActivityHook,
    } as Partial<IDataSourcePort>);
    const confirmation = fixture.debugElement.injector.get(ConfirmationService);
    const confirmSpy = vi.spyOn(confirmation, 'confirm').mockReturnValue(confirmation);
    proto.activityStatus.set(activityStatusOf({ installed: false }));

    proto.onActivityHookToggle();
    await flush();

    expect(installActivityHook).toHaveBeenNthCalledWith(1, 'claude', undefined);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // The dialog names the file the install would modify.
    expect(String(confirmSpy.mock.calls[0][0].message)).toContain('.claude/settings.json');

    confirmSpy.mock.calls[0][0].accept?.();
    await flush();

    expect(installActivityHook).toHaveBeenNthCalledWith(2, 'claude', { confirm: true });
    expect(proto.activityStatus()?.installed).toBe(true);
    expect(proto.activityButtonLabel()).toBe('Uninstall Claude activity hook');
    expect(proto.activityAnnouncement()).toContain('.claude/settings.json');
  });

  it('install: dismissing the consent dialog fires no retry', async () => {
    const installActivityHook = vi
      .fn()
      .mockRejectedValueOnce(new DataSourceError('confirm-required', 'needs confirm'));
    const { fixture, proto } = bootstrapActivity({
      installActivityHook,
    } as Partial<IDataSourcePort>);
    const confirmation = fixture.debugElement.injector.get(ConfirmationService);
    const confirmSpy = vi.spyOn(confirmation, 'confirm').mockReturnValue(confirmation);
    proto.activityStatus.set(activityStatusOf({ installed: false }));

    proto.onActivityHookToggle();
    await flush();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(installActivityHook).toHaveBeenCalledTimes(1);
    expect(proto.activityStatus()?.installed).toBe(false);
  });

  it('uninstall: routed when installed, confirmed retry adopts removed: true', async () => {
    const uninstallActivityHook = vi
      .fn()
      .mockRejectedValueOnce(new DataSourceError('confirm-required', 'needs confirm'))
      .mockResolvedValueOnce({ ...activityStatusOf({ installed: false }), removed: true });
    const { fixture, proto } = bootstrapActivity({
      uninstallActivityHook,
    } as Partial<IDataSourcePort>);
    const confirmation = fixture.debugElement.injector.get(ConfirmationService);
    const confirmSpy = vi.spyOn(confirmation, 'confirm').mockReturnValue(confirmation);
    proto.activityStatus.set(
      activityStatusOf({ installed: true, configWired: true, bridgePresent: true }),
    );

    proto.onActivityHookToggle();
    await flush();
    confirmSpy.mock.calls[0][0].accept?.();
    await flush();

    expect(uninstallActivityHook).toHaveBeenNthCalledWith(2, 'claude', { confirm: true });
    expect(proto.activityStatus()?.installed).toBe(false);
    expect(proto.activityButtonLabel()).toBe('Install Claude activity hook');
  });
});

/**
 * Conversation-capture row (spec/provider-activity.md §Conversation
 * capture). Consent is settled client-side: both directions run
 * through the ConfirmationService dialog and the POST always carries
 * `confirm: true`, so the server's 412 path never fires from this
 * surface. The spec drives the imperative surface with the
 * component-scoped ConfirmationService spied to accept / reject.
 */
describe('SettingsProject, conversation-capture toggle', () => {
  interface ICaptureProto {
    captureEnabled(): boolean;
    captureError(): string | null;
    captureStatus: WritableSignal<{ enabled: boolean } | null>;
    onCaptureToggle(next: boolean): void;
    isPending(key: string): boolean;
  }

  function bootstrapCapture(stub: Partial<IDataSourcePort>): {
    proto: ICaptureProto;
    fixture: ReturnType<typeof TestBed.createComponent<SettingsProject>>;
    confirmation: ConfirmationService;
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
    const confirmation = fixture.debugElement.injector.get(ConfirmationService);
    return {
      proto: fixture.componentInstance as unknown as ICaptureProto,
      fixture,
      confirmation,
    };
  }

  async function flushAsync(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('fetches the gate state on section open and reflects it', async () => {
    const getActivityCapture = vi.fn().mockResolvedValue({ enabled: true });
    const { proto, fixture } = bootstrapCapture({ getActivityCapture });
    expect(getActivityCapture).not.toHaveBeenCalled();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    expect(getActivityCapture).toHaveBeenCalledTimes(1);
    expect(proto.captureEnabled()).toBe(true);
  });

  it('enabling goes through the consent dialog and POSTs with confirm: true', async () => {
    const setActivityCapture = vi.fn().mockResolvedValue({ enabled: true });
    const { proto, confirmation } = bootstrapCapture({
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
      setActivityCapture,
    });
    proto.captureStatus.set({ enabled: false });
    const confirmSpy = vi.spyOn(confirmation, 'confirm').mockReturnValue(confirmation);

    proto.onCaptureToggle(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Simulate the operator accepting the consent dialog.
    confirmSpy.mock.calls[0][0].accept?.();
    await flushAsync();

    expect(setActivityCapture).toHaveBeenCalledWith({ enabled: true, confirm: true });
    expect(proto.captureEnabled()).toBe(true);
  });

  it('a dismissed dialog writes nothing and keeps the current state', async () => {
    const setActivityCapture = vi.fn();
    const { proto, confirmation } = bootstrapCapture({
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
      setActivityCapture,
    });
    proto.captureStatus.set({ enabled: false });
    const confirmSpy = vi.spyOn(confirmation, 'confirm').mockReturnValue(confirmation);

    proto.onCaptureToggle(true);
    confirmSpy.mock.calls[0][0].reject?.();
    await flushAsync();

    expect(setActivityCapture).not.toHaveBeenCalled();
    expect(proto.captureEnabled()).toBe(false);
  });

  it('disabling also confirms, POSTs confirm: true, and adopts the off state', async () => {
    const setActivityCapture = vi.fn().mockResolvedValue({ enabled: false });
    const { proto, confirmation } = bootstrapCapture({ setActivityCapture });
    proto.captureStatus.set({ enabled: true });
    const confirmSpy = vi.spyOn(confirmation, 'confirm').mockReturnValue(confirmation);

    proto.onCaptureToggle(false);
    confirmSpy.mock.calls[0][0].accept?.();
    await flushAsync();

    expect(setActivityCapture).toHaveBeenCalledWith({ enabled: false, confirm: true });
    expect(proto.captureEnabled()).toBe(false);
  });

  it('a failed write surfaces through captureError and the state stays put', async () => {
    const { proto, confirmation } = bootstrapCapture({
      setActivityCapture: vi
        .fn()
        .mockRejectedValue(new DataSourceError('internal', 'boom')),
    });
    proto.captureStatus.set({ enabled: false });
    const confirmSpy = vi.spyOn(confirmation, 'confirm').mockReturnValue(confirmation);

    proto.onCaptureToggle(true);
    confirmSpy.mock.calls[0][0].accept?.();
    await flushAsync();

    expect(proto.captureError()).toBe('boom');
    expect(proto.captureEnabled()).toBe(false);
  });

  it('marks the row pending while the write is in flight', async () => {
    let resolveWrite: (v: { enabled: boolean }) => void = () => undefined;
    const setActivityCapture = vi.fn().mockReturnValue(
      new Promise<{ enabled: boolean }>((resolve) => {
        resolveWrite = resolve;
      }),
    );
    const { proto, confirmation } = bootstrapCapture({ setActivityCapture });
    proto.captureStatus.set({ enabled: false });
    const confirmSpy = vi.spyOn(confirmation, 'confirm').mockReturnValue(confirmation);

    proto.onCaptureToggle(true);
    confirmSpy.mock.calls[0][0].accept?.();
    await Promise.resolve();
    expect(proto.isPending('activity.capture')).toBe(true);

    resolveWrite({ enabled: true });
    await flushAsync();
    expect(proto.isPending('activity.capture')).toBe(false);
    expect(proto.captureEnabled()).toBe(true);
  });
});
