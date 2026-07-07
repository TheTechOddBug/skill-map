import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmationService } from 'primeng/api';

import { SettingsProject } from '../settings-project';
import { SettingsProjectCapture } from '../settings-project-capture';
import { SettingsProjectHook } from '../settings-project-hook';
import { SettingsProjectLens } from '../settings-project-lens';
import { SettingsProjectLive } from '../settings-project-live';
import { SettingsProjectPreferences } from '../settings-project-preferences';
import { SettingsProjectRealtime } from '../settings-project-realtime';
import { ActivityReadinessService } from '../../../services/activity-readiness';
import {
  DATA_SOURCE,
  DataSourceError,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import { ProviderRegistryService } from '../../../../services/provider-registry';
import type {
  IActiveProviderApi,
  IActivityInstallStatusApi,
  IProjectPreferencesApi,
  IProviderRegistryApi,
} from '../../../../models/api';

/**
 * SettingsProject chassis · after the section was split into four
 * self-contained children, the one NEW failure mode is the chassis
 * silently dropping a mount (the section would just lose its rows).
 * This smoke test pins every row's testid through the full composed
 * tree. `visible: false` keeps the children's fetch effects dormant,
 * so the empty DATA_SOURCE stub is never called.
 */
describe('SettingsProject chassis', () => {
  it('mounts the five domain children (every project row renders)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DATA_SOURCE, useValue: {} as Partial<IDataSourcePort> },
        // The live child injects WsEventStreamService; demo mode keeps
        // it inert (no socket) without further stubbing.
        { provide: SKILL_MAP_MODE, useValue: 'demo' },
      ],
    });
    const fixture = TestBed.createComponent(SettingsProject);
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    for (const testid of [
      'settings-project-active-provider-row',
      'settings-project-activity-hook-row',
      'settings-project-live-updates-row',
      'settings-project-live-activity-row',
      'settings-project-activity-capture-row',
      'settings-project-sidecar-writers-row',
      'settings-project-plugin-trust-row',
      'settings-project-follow-external-symlinks-row',
      'settings-project-reference-paths-row',
      'settings-project-ignore-patterns-row',
      'settings-project-respect-gitignore-row',
    ]) {
      expect(
        root.querySelector(`[data-testid="${testid}"]`),
        `missing row [data-testid="${testid}"]`,
      ).not.toBeNull();
    }
  });
});

/**
 * SettingsProjectLens · active-lens dropdown gating.
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
  const fixture = TestBed.createComponent(SettingsProjectLens);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  TestBed.inject(ProviderRegistryService).ingest(REGISTRY);
  const proto = fixture.componentInstance as unknown as IProjectProto;
  return { proto };
}

describe('SettingsProjectLens providerOptions', () => {
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
    const fixture = TestBed.createComponent(SettingsProjectLens);
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
 * SettingsProjectLens · active-provider select rollback. The dropdown
 * binds a `linkedSignal` view of the envelope value; dismissing the
 * lens-switch confirm resets it to the committed value so the control
 * rolls back (the committed computed alone cannot notify an unchanged
 * value through the one-way binding).
 */
describe('SettingsProjectLens active-provider select rollback', () => {
  interface ILensSelectProto {
    activeProviderEnvelope: WritableSignal<IActiveProviderApi | null>;
    activeProviderView(): string;
    onActiveProviderChange(next: string): void;
  }

  it('dismissing the lens-switch confirm rolls the dropdown back', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DATA_SOURCE, useValue: {} as Partial<IDataSourcePort> },
      ],
    });
    const fixture = TestBed.createComponent(SettingsProjectLens);
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    TestBed.inject(ProviderRegistryService).ingest(REGISTRY);
    const proto = fixture.componentInstance as unknown as ILensSelectProto;
    const confirmation = fixture.debugElement.injector.get(ConfirmationService);
    const confirmSpy = vi.spyOn(confirmation, 'confirm').mockReturnValue(confirmation);

    proto.activeProviderEnvelope.set(envelope(['claude', 'codex', 'agent-skills']));
    expect(proto.activeProviderView()).toBe('agent-skills');

    proto.onActiveProviderChange('claude');
    // Optimistic while the destructive-switch dialog is up.
    expect(proto.activeProviderView()).toBe('claude');
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    confirmSpy.mock.calls[0][0].reject?.();
    expect(proto.activeProviderView()).toBe('agent-skills');
  });
});

/**
 * SettingsProjectPreferences · `pluginTrust.projectEnabled` machine-local opt-in.
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
  pluginTrustEnabledView(): boolean;
  onProjectTrustToggle(next: boolean): void;
  followExternalSymlinks(): boolean;
  followExternalSymlinksView(): boolean;
  onFollowExternalSymlinksToggle(next: boolean): void;
  respectGitignore(): boolean;
  respectGitignoreView(): boolean;
  onRespectGitignoreToggle(next: boolean): void;
}

function prefs(projectEnabled: boolean): IProjectPreferencesApi {
  return {
    allowSidecarWriters: true,
    scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
    pluginTrust: { projectEnabled },
  };
}

function prefsSymlinks(followExternalSymlinks: boolean): IProjectPreferencesApi {
  return {
    allowSidecarWriters: true,
    scan: { referencePaths: [], followExternalSymlinks, respectGitignore: false },
    pluginTrust: { projectEnabled: false },
  };
}

function prefsGitignore(respectGitignore: boolean): IProjectPreferencesApi {
  return {
    allowSidecarWriters: true,
    scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore },
    pluginTrust: { projectEnabled: false },
  };
}

function bootstrapTrust(stub: Partial<IDataSourcePort>): {
  fixture: ReturnType<typeof TestBed.createComponent<SettingsProjectPreferences>>;
  proto: ITrustProto;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
    ],
  });
  const fixture = TestBed.createComponent(SettingsProjectPreferences);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  const proto = fixture.componentInstance as unknown as ITrustProto;
  return { fixture, proto };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SettingsProjectPreferences pluginTrust opt-in', () => {
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
    // While the dialog is up the switch optimistically shows ON.
    expect(proto.pluginTrustEnabledView()).toBe(true);

    // The operator cancels: no retry fires, the committed value stays
    // off AND the switch view rolls back (regression: the control used
    // to stay flipped because the committed computed never changed).
    confirmSpy.mock.calls[0][0].reject?.();
    await flush();

    expect(setProjectPreferences).toHaveBeenCalledTimes(1);
    expect(proto.pluginTrustEnabled()).toBe(false);
    expect(proto.pluginTrustEnabledView()).toBe(false);
  });
});

/**
 * SettingsProjectPreferences · `scan.followExternalSymlinks` opt-in.
 *
 * Mirrors the plugin-trust opt-in: the toggle persists through
 * `setProjectPreferences`, but the key nests under `scan.*`. Turning it
 * OFF narrows the scan's disk-access surface (direct write). Turning it
 * ON expands it (it re-enables following links that escape the project
 * root), so the BFF answers 412 `confirm-required`; the component reuses
 * the same `<p-confirmdialog>` / `ConfirmationService` mechanism,
 * re-issuing the patch with `confirm: true` only after the operator
 * accepts.
 */
describe('SettingsProjectPreferences followExternalSymlinks opt-in', () => {
  it('reads scan.followExternalSymlinks from the loaded preferences', () => {
    const { proto } = bootstrapTrust({});
    expect(proto.followExternalSymlinks()).toBe(false);
    proto.preferences.set(prefsSymlinks(true));
    expect(proto.followExternalSymlinks()).toBe(true);
  });

  it('turning the opt-in OFF persists directly (no confirm)', async () => {
    const setProjectPreferences = vi.fn().mockResolvedValue(prefsSymlinks(false));
    const { proto } = bootstrapTrust({
      setProjectPreferences,
    } as Partial<IDataSourcePort>);

    proto.onFollowExternalSymlinksToggle(false);
    await flush();

    expect(setProjectPreferences).toHaveBeenCalledWith({
      scan: { followExternalSymlinks: false },
    });
  });

  it('turning the opt-in ON surfaces the confirm dialog and retries with confirm:true on accept', async () => {
    const setProjectPreferences = vi
      .fn()
      .mockRejectedValueOnce(new DataSourceError('confirm-required', 'needs confirm'))
      .mockResolvedValueOnce(prefsSymlinks(true));
    const { fixture, proto } = bootstrapTrust({
      setProjectPreferences,
    } as Partial<IDataSourcePort>);
    const confirmation = fixture.debugElement.injector.get(ConfirmationService);
    const confirmSpy = vi
      .spyOn(confirmation, 'confirm')
      .mockReturnValue(confirmation);

    proto.onFollowExternalSymlinksToggle(true);
    await flush();

    expect(setProjectPreferences).toHaveBeenNthCalledWith(1, {
      scan: { followExternalSymlinks: true },
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    // Simulate the operator accepting the confirm dialog.
    confirmSpy.mock.calls[0][0].accept?.();
    await flush();

    expect(setProjectPreferences).toHaveBeenNthCalledWith(2, {
      scan: { followExternalSymlinks: true },
      confirm: true,
    });
    expect(proto.followExternalSymlinks()).toBe(true);
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

    proto.onFollowExternalSymlinksToggle(true);
    await flush();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // While the dialog is up the switch optimistically shows ON.
    expect(proto.followExternalSymlinksView()).toBe(true);

    // The operator cancels: no retry fires, the committed value stays
    // off AND the switch view rolls back (regression: the control used
    // to stay flipped because the committed computed never changed).
    confirmSpy.mock.calls[0][0].reject?.();
    await flush();

    expect(setProjectPreferences).toHaveBeenCalledTimes(1);
    expect(proto.followExternalSymlinks()).toBe(false);
    expect(proto.followExternalSymlinksView()).toBe(false);
  });
});

/**
 * SettingsProjectPreferences · `scan.respectGitignore` committed opt-in.
 *
 * Unlike the two keys above it is a COMMITTED, ungated toggle (it never
 * reads outside the project root), so a flip in either direction persists
 * directly through `setProjectPreferences` with no confirm dialog. The
 * view signal still rolls back when the PATCH itself rejects.
 */
describe('SettingsProjectPreferences respectGitignore opt-in', () => {
  it('reads scan.respectGitignore from the loaded preferences (default off)', () => {
    const { proto } = bootstrapTrust({});
    expect(proto.respectGitignore()).toBe(false);
    proto.preferences.set(prefsGitignore(true));
    expect(proto.respectGitignore()).toBe(true);
  });

  it('turning it ON persists directly with no confirm', async () => {
    const setProjectPreferences = vi.fn().mockResolvedValue(prefsGitignore(true));
    const { proto } = bootstrapTrust({
      setProjectPreferences,
    } as Partial<IDataSourcePort>);

    proto.onRespectGitignoreToggle(true);
    await flush();

    expect(setProjectPreferences).toHaveBeenCalledTimes(1);
    expect(setProjectPreferences).toHaveBeenCalledWith({
      scan: { respectGitignore: true },
    });
  });

  it('rolls the switch view back when the PATCH rejects', async () => {
    const setProjectPreferences = vi
      .fn()
      .mockRejectedValueOnce(new DataSourceError('boom', 'persist failed'));
    const { proto } = bootstrapTrust({
      setProjectPreferences,
    } as Partial<IDataSourcePort>);

    proto.onRespectGitignoreToggle(true);
    // Optimistic flip while the write is in flight.
    expect(proto.respectGitignoreView()).toBe(true);
    await flush();

    // The write failed, so the committed value never changed and the
    // switch view rolls back to off.
    expect(proto.respectGitignore()).toBe(false);
    expect(proto.respectGitignoreView()).toBe(false);
  });
});

/**
 * SettingsProjectHook · live-activity hook button (extracted from the
 * lens child so the section rows order freely).
 *
 * One button: Install when the hook is absent, Uninstall when present,
 * disabled + hint for lenses without an activity adapter. Both
 * mutations first POST WITHOUT `confirm`; the server-enforced 412
 * `confirm-required` surfaces the consent dialog and accepting retries
 * with `confirm: true` (the same flow the plugin-trust opt-in uses).
 * The active lens arrives through the `lensId` input (fed by the
 * chassis from the lens child). The spec drives the imperative surface
 * + the component-provided ConfirmationService, independent of
 * PrimeNG's overlay portal.
 */
interface IActivityProto {
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
  fixture: ReturnType<typeof TestBed.createComponent<SettingsProjectHook>>;
  proto: IActivityProto;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
      // Severs the readiness probe's WS chain; the hook child only
      // fires refresh() after a mutation, irrelevant to these specs.
      {
        provide: ActivityReadinessService,
        useValue: {
          hookInstalled: signal<boolean | null>(null).asReadonly(),
          refresh: vi.fn().mockResolvedValue(undefined),
        } as unknown as ActivityReadinessService,
      },
    ],
  });
  const fixture = TestBed.createComponent(SettingsProjectHook);
  fixture.componentRef.setInput('visible', false);
  fixture.componentRef.setInput('lensId', 'claude');
  fixture.detectChanges();
  TestBed.inject(ProviderRegistryService).ingest(REGISTRY);
  const proto = fixture.componentInstance as unknown as IActivityProto;
  return { fixture, proto };
}

describe('SettingsProjectHook activity hook button', () => {
  it('labels Install / Uninstall off the status and the lens registry label', () => {
    const { proto } = bootstrapActivity({});
    proto.activityStatus.set(activityStatusOf({ installed: false }));
    expect(proto.activityButtonLabel()).toBe('Install Claude hook');
    expect(proto.activityButtonDisabled()).toBe(false);
    expect(proto.activityHint()).toBe(null);

    proto.activityStatus.set(activityStatusOf({ installed: true }));
    expect(proto.activityButtonLabel()).toBe('Uninstall Claude hook');
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
    // The dialog names the harness FILE the install would modify
    // (basename only; the full path read as noise, e.g. opencode's
    // .opencode/plugin/skill-map-activity.js).
    expect(String(confirmSpy.mock.calls[0][0].message)).toContain('settings.json');
    expect(String(confirmSpy.mock.calls[0][0].message)).not.toContain('.claude/');

    confirmSpy.mock.calls[0][0].accept?.();
    await flush();

    expect(installActivityHook).toHaveBeenNthCalledWith(2, 'claude', { confirm: true });
    expect(proto.activityStatus()?.installed).toBe(true);
    expect(proto.activityButtonLabel()).toBe('Uninstall Claude hook');
    // The announcement is outcome-only (the touched path was already
    // named by the consent dialog) and names the CLI it wired.
    expect(proto.activityAnnouncement()).toBe('Claude real-time hook installed.');
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
    expect(proto.activityButtonLabel()).toBe('Install Claude hook');
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
describe('SettingsProjectCapture, conversation-capture toggle', () => {
  interface ICaptureProto {
    captureEnabled(): boolean;
    captureEnabledView(): boolean;
    captureError(): string | null;
    captureStatus: WritableSignal<{ enabled: boolean } | null>;
    onCaptureToggle(next: boolean): void;
    isPending(key: string): boolean;
  }

  function bootstrapCapture(stub: Partial<IDataSourcePort>): {
    proto: ICaptureProto;
    fixture: ReturnType<typeof TestBed.createComponent<SettingsProjectCapture>>;
    confirmation: ConfirmationService;
  } {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DATA_SOURCE, useValue: stub },
      ],
    });
    const fixture = TestBed.createComponent(SettingsProjectCapture);
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
    // Optimistic ON while the dialog is up.
    expect(proto.captureEnabledView()).toBe(true);
    confirmSpy.mock.calls[0][0].reject?.();
    await flushAsync();

    expect(setActivityCapture).not.toHaveBeenCalled();
    expect(proto.captureEnabled()).toBe(false);
    // The switch view rolls back too (regression: it used to stay
    // flipped, the committed computed never changed so it never
    // notified the one-way binding).
    expect(proto.captureEnabledView()).toBe(false);
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
    // A failed write also rolls the switch view back.
    expect(proto.captureEnabledView()).toBe(false);
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

/**
 * SettingsProjectLive / SettingsProjectRealtime · live-channel rows
 * (moved here from the General section when `ui.liveUpdates` /
 * `ui.realtimeActivity` became project-local config; split into two
 * children so the hook installer can sit between them). Display state
 * comes from the feature owners (`WsEventStreamService` /
 * `NodeActivityService`); writes route through their `setEnabled`,
 * which persists via the project-preferences PATCH. The real-time
 * toggle is gated by live updates AND by the active lens's hook
 * install state (shared `ActivityReadinessService`; `null` = unknown
 * FAILS OPEN).
 */
function liveProviders(opts?: { hookInstalled?: boolean | null }): {
  setProjectPreferences: ReturnType<typeof vi.fn>;
  readinessRefresh: ReturnType<typeof vi.fn>;
} {
  TestBed.resetTestingModule();
  const setProjectPreferences = vi.fn().mockResolvedValue({});
  const readinessRefresh = vi.fn().mockResolvedValue(undefined);
  // NOT `??`: an explicit `null` (hook state unknown) must survive.
  const hookInstalled = opts?.hookInstalled === undefined ? true : opts.hookInstalled;
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: DATA_SOURCE,
        useValue: {
          getProjectPreferences: () => Promise.resolve({}),
          setProjectPreferences,
        } as unknown as Partial<IDataSourcePort>,
      },
      // Demo mode keeps the WS owner inert (no socket) in TestBed.
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
      {
        provide: ActivityReadinessService,
        useValue: {
          hookInstalled: signal(hookInstalled).asReadonly(),
          refresh: readinessRefresh,
        } as unknown as ActivityReadinessService,
      },
    ],
  });
  return { setProjectPreferences, readinessRefresh };
}

describe('SettingsProjectLive, live-updates row', () => {
  it('renders the row and routes the write through the WS owner (server-backed)', () => {
    const { setProjectPreferences } = liveProviders();
    const fixture = TestBed.createComponent(SettingsProjectLive);
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    interface ILiveProto {
      liveWsEnabled(): boolean;
      onLiveWsToggle(next: boolean): void;
    }
    const proto = fixture.componentInstance as unknown as ILiveProto;
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="settings-project-live-updates-row"]')).not.toBeNull();

    expect(proto.liveWsEnabled()).toBe(true);
    proto.onLiveWsToggle(false);
    expect(proto.liveWsEnabled()).toBe(false);
    // Persisted through the owner into the storage seam: a
    // project-preferences PATCH (settings.local.json).
    expect(setProjectPreferences).toHaveBeenCalledWith({ ui: { liveUpdates: false } });
  });
});

describe('SettingsProjectRealtime, real-time-activity row', () => {
  interface IRealtimeProto {
    liveActivityEnabled(): boolean;
    activityHookInstalled(): boolean | null;
    onLiveActivityToggle(next: boolean): void;
  }

  function createRealtime(): {
    fixture: ReturnType<typeof TestBed.createComponent<SettingsProjectRealtime>>;
    proto: IRealtimeProto;
  } {
    const fixture = TestBed.createComponent(SettingsProjectRealtime);
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    return { fixture, proto: fixture.componentInstance as unknown as IRealtimeProto };
  }

  it('routes the write through the activity owner (server-backed)', () => {
    const { setProjectPreferences } = liveProviders();
    const { proto } = createRealtime();
    expect(proto.liveActivityEnabled()).toBe(true);
    proto.onLiveActivityToggle(false);
    expect(proto.liveActivityEnabled()).toBe(false);
    expect(setProjectPreferences).toHaveBeenCalledWith({ ui: { realtimeActivity: false } });
  });

  it('disables with a hint while the activity hook is not installed', () => {
    liveProviders({ hookInstalled: false });
    const { fixture, proto } = createRealtime();
    expect(proto.activityHookInstalled()).toBe(false);
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el.querySelector('[data-testid="settings-project-live-activity-hook-hint"]'),
    ).not.toBeNull();
  });

  it('fails OPEN while the hook state is unknown (no hint, toggle usable)', () => {
    liveProviders({ hookInstalled: null });
    const { fixture, proto } = createRealtime();
    expect(proto.activityHookInstalled()).toBe(null);
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el.querySelector('[data-testid="settings-project-live-activity-hook-hint"]'),
    ).toBeNull();
  });

  it('re-probes the shared hook-install state on section open', () => {
    const { readinessRefresh } = liveProviders();
    const { fixture } = createRealtime();
    expect(readinessRefresh).not.toHaveBeenCalled();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    expect(readinessRefresh).toHaveBeenCalled();
  });
});
