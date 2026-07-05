import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SettingsGeneral } from '../settings-general';
import {
  DATA_SOURCE,
  DataSourceError,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import type { IPreferencesApi, IPreferencesPatchApi } from '../../../../models/api';

/**
 * SettingsGeneral coverage. The section drives a declarative
 * `GENERAL_TOGGLES` array (fetch-on-visible / patch-on-toggle), today
 * carrying two toggles: `updateCheck.enabled` and the relocated
 * `telemetry.errorsEnabled` (moved here from the retired Privacy
 * section). The spec exercises:
 *   - `visible()` flipping to true triggers a single `getPreferences()`,
 *     and the SAME fetch feeds both toggles (no second request).
 *   - each toggle reads its dot-path value out of the envelope.
 *   - flipping a toggle PATCHes only that sub-key and adopts the
 *     post-write envelope as the new local state.
 *   - a failed save surfaces through `saveError` without throwing, and
 *     the optimistic value never sticks.
 *   - a failed load surfaces through `loadError`.
 *
 * The data-source is stubbed; assertions target the component's
 * imperative surface + the stub call shapes (matching the
 * settings-plugins spec, which keeps the test independent of PrimeNG's
 * overlay portal). The real `read` / `patch` functions live on the
 * component's `toggles[]` defs, so tests pull a def out by key rather
 * than fabricating one. `ThemeService` (consumed by the extra-theme
 * selector) is `providedIn: 'root'` and self-provides against the
 * jsdom `DOCUMENT`, so no extra provider is needed.
 */

// `telemetryOn` drives all three fields at once: the UI exposes one
// consolidated telemetry switch, ON only when every field is on.
function prefs(updateCheck: boolean, telemetryOn: boolean): IPreferencesApi {
  return {
    updateCheck: { enabled: updateCheck },
    telemetry: {
      errorsEnabled: telemetryOn,
      usageCliEnabled: telemetryOn,
      usageUiEnabled: telemetryOn,
      anonymousId: null,
      environment: 'prod',
    },
  };
}

type TToggleKey = 'updateCheck.enabled' | 'telemetry';

interface IGeneralToggleDefLike {
  key: TToggleKey;
  read(envelope: IPreferencesApi): boolean;
  patch(value: boolean): IPreferencesPatchApi;
}

interface IGeneralProto {
  toggles: ReadonlyArray<IGeneralToggleDefLike>;
  valueOf(def: IGeneralToggleDefLike): boolean;
  onToggle(def: IGeneralToggleDefLike, next: boolean): void;
  loadError(): string | null;
  saveError(): string | null;
}

interface IBootstrapResult {
  cmp: SettingsGeneral;
  proto: IGeneralProto;
  fixture: ReturnType<typeof TestBed.createComponent<SettingsGeneral>>;
}

function bootstrap(stub: Partial<IDataSourcePort>): IBootstrapResult {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
      // The live-channel toggles inject WsEventStreamService /
      // NodeActivityService; demo mode keeps both inert (no socket,
      // EMPTY stream) without further stubbing.
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
    ],
  });
  const fixture = TestBed.createComponent(SettingsGeneral);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  const cmp = fixture.componentInstance;
  const proto = cmp as unknown as IGeneralProto;
  return { cmp, proto, fixture };
}

function defByKey(proto: IGeneralProto, key: TToggleKey): IGeneralToggleDefLike {
  const def = proto.toggles.find((d) => d.key === key);
  if (!def) throw new Error(`SettingsGeneral has no toggle def for "${key}"`);
  return def;
}

// Hop through two microtasks so the `effect` that calls `refresh()`
// resolves and the envelope signal is populated before assertions.
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SettingsGeneral', () => {
  it('fetches preferences once when the section becomes visible and feeds both toggles', async () => {
    const getPreferences = vi.fn().mockResolvedValue(prefs(true, false));
    const { proto, fixture } = bootstrap({ getPreferences, setPreferences: vi.fn() });

    expect(getPreferences).not.toHaveBeenCalled();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    expect(getPreferences).toHaveBeenCalledTimes(1);
    expect(proto.valueOf(defByKey(proto, 'updateCheck.enabled'))).toBe(true);
    expect(proto.valueOf(defByKey(proto, 'telemetry'))).toBe(false);
  });

  it('reflects telemetry.errorsEnabled=true from the envelope into the toggle value', async () => {
    const { proto, fixture } = bootstrap({
      getPreferences: vi.fn().mockResolvedValue(prefs(false, true)),
      setPreferences: vi.fn(),
    });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    expect(proto.valueOf(defByKey(proto, 'telemetry'))).toBe(true);
  });

  it('PATCHes telemetry.errorsEnabled on toggle and adopts the response', async () => {
    const getPreferences = vi.fn().mockResolvedValue(prefs(true, false));
    const setPreferences = vi.fn().mockResolvedValue(prefs(true, true));
    const { proto, fixture } = bootstrap({ getPreferences, setPreferences });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    proto.onToggle(defByKey(proto, 'telemetry'), true);
    await flushAsync();

    expect(setPreferences).toHaveBeenCalledTimes(1);
    expect(setPreferences).toHaveBeenCalledWith({
      telemetry: { errorsEnabled: true, usageCliEnabled: true, usageUiEnabled: true },
    });
    expect(proto.valueOf(defByKey(proto, 'telemetry'))).toBe(true);
  });

  it('PATCHes updateCheck.enabled on toggle and adopts the response', async () => {
    const getPreferences = vi.fn().mockResolvedValue(prefs(true, false));
    const setPreferences = vi.fn().mockResolvedValue(prefs(false, false));
    const { proto, fixture } = bootstrap({ getPreferences, setPreferences });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    proto.onToggle(defByKey(proto, 'updateCheck.enabled'), false);
    await flushAsync();

    expect(setPreferences).toHaveBeenCalledTimes(1);
    expect(setPreferences).toHaveBeenCalledWith({ updateCheck: { enabled: false } });
    expect(proto.valueOf(defByKey(proto, 'updateCheck.enabled'))).toBe(false);
  });

  it('surfaces a failed save through saveError without throwing', async () => {
    const getPreferences = vi.fn().mockResolvedValue(prefs(true, false));
    const setPreferences = vi
      .fn()
      .mockRejectedValue(new DataSourceError('demo-readonly', 'nope'));
    const { proto, fixture } = bootstrap({ getPreferences, setPreferences });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    proto.onToggle(defByKey(proto, 'telemetry'), true);
    await flushAsync();

    expect(proto.saveError()).toBe('nope');
    // The optimistic value never sticks on failure: state stays at the
    // last good envelope (errorsEnabled=false).
    expect(proto.valueOf(defByKey(proto, 'telemetry'))).toBe(false);
  });

  it('surfaces a failed load through loadError', async () => {
    const { proto, fixture } = bootstrap({
      getPreferences: vi.fn().mockRejectedValue(new Error('boom')),
      setPreferences: vi.fn(),
    });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    expect(proto.loadError()).toBe('boom');
  });

  it('live-channel toggles render and route through the feature owners (localStorage-backed)', async () => {
    const WS_KEY = 'sm.live.ws-enabled';
    const ACTIVITY_KEY = 'sm.live.activity-enabled';
    try {
      const { fixture } = bootstrap({
        getPreferences: vi.fn().mockResolvedValue(prefs(true, true)),
        setPreferences: vi.fn(),
      });
      const el: HTMLElement = fixture.nativeElement;
      const wsRow = el.querySelector('[data-testid="settings-general-row-live-ws"]');
      const activityRow = el.querySelector('[data-testid="settings-general-row-live-activity"]');
      expect(wsRow).not.toBeNull();
      expect(activityRow).not.toBeNull();

      interface ILiveProto {
        liveWsEnabled(): boolean;
        liveActivityEnabled(): boolean;
        onLiveWsToggle(next: boolean): void;
        onLiveActivityToggle(next: boolean): void;
      }
      const live = fixture.componentInstance as unknown as ILiveProto;
      expect(live.liveWsEnabled()).toBe(true);
      expect(live.liveActivityEnabled()).toBe(true);

      live.onLiveWsToggle(false);
      live.onLiveActivityToggle(false);
      expect(live.liveWsEnabled()).toBe(false);
      expect(live.liveActivityEnabled()).toBe(false);
      // Persisted through the owners into the storage seam.
      expect(localStorage.getItem(WS_KEY)).toBe('false');
      expect(localStorage.getItem(ACTIVITY_KEY)).toBe('false');
    } finally {
      localStorage.removeItem(WS_KEY);
      localStorage.removeItem(ACTIVITY_KEY);
    }
  });

  it('real-time toggle disables with a hint while the activity hook is not installed', async () => {
    interface IHookProto {
      activityHookInstalled(): boolean | null;
    }
    const status = {
      provider: 'claude',
      supported: true,
      installed: false,
      configPath: '.claude/settings.json',
      configWired: false,
      bridgePresent: false,
      events: 5,
    };
    const { fixture } = bootstrap({
      getPreferences: vi.fn().mockResolvedValue(prefs(true, true)),
      setPreferences: vi.fn(),
      getActiveProvider: vi.fn().mockResolvedValue({
        activeProvider: 'claude',
        detected: [],
        source: 'config',
        selectable: ['claude'],
        markerDrift: null,
      }),
      getActivityInstallStatus: vi.fn().mockResolvedValue(status),
    } as Partial<IDataSourcePort>);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    await flushAsync();
    fixture.detectChanges();

    const proto = fixture.componentInstance as unknown as IHookProto;
    expect(proto.activityHookInstalled()).toBe(false);
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el.querySelector('[data-testid="settings-general-live-activity-hook-hint"]'),
    ).not.toBeNull();
  });

  it('real-time toggle stays enabled when the hook is installed, and fails OPEN on a probe error', async () => {
    interface IHookProto {
      activityHookInstalled(): boolean | null;
    }
    // Installed: gate off.
    const installed = bootstrap({
      getPreferences: vi.fn().mockResolvedValue(prefs(true, true)),
      setPreferences: vi.fn(),
      getActiveProvider: vi.fn().mockResolvedValue({
        activeProvider: 'claude',
        detected: [],
        source: 'config',
        selectable: ['claude'],
        markerDrift: null,
      }),
      getActivityInstallStatus: vi.fn().mockResolvedValue({
        provider: 'claude',
        supported: true,
        installed: true,
        configPath: '.claude/settings.json',
        configWired: true,
        bridgePresent: true,
        events: 5,
      }),
    } as Partial<IDataSourcePort>);
    installed.fixture.componentRef.setInput('visible', true);
    installed.fixture.detectChanges();
    await flushAsync();
    await flushAsync();
    expect(
      (installed.fixture.componentInstance as unknown as IHookProto).activityHookInstalled(),
    ).toBe(true);

    // Probe failure: unknown, never locks the toggle.
    const failing = bootstrap({
      getPreferences: vi.fn().mockResolvedValue(prefs(true, true)),
      setPreferences: vi.fn(),
      getActiveProvider: vi.fn().mockRejectedValue(new Error('down')),
    } as Partial<IDataSourcePort>);
    failing.fixture.componentRef.setInput('visible', true);
    failing.fixture.detectChanges();
    await flushAsync();
    await flushAsync();
    expect(
      (failing.fixture.componentInstance as unknown as IHookProto).activityHookInstalled(),
    ).toBe(null);
  });
});

describe('SettingsGeneral, shared ActivityReadinessService', () => {
  it('mirrors the shared hook-install signal and re-probes through it on open', async () => {
    const { ActivityReadinessService } = await import('../../../services/activity-readiness');
    const { signal } = await import('@angular/core');

    const hook = signal<boolean | null>(false);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const readinessStub = {
      hookInstalled: hook.asReadonly(),
      refresh,
    } as unknown as InstanceType<typeof ActivityReadinessService>;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: DATA_SOURCE,
          useValue: {
            getPreferences: vi.fn().mockResolvedValue(prefs(true, true)),
            setPreferences: vi.fn(),
          } as Partial<IDataSourcePort>,
        },
        { provide: SKILL_MAP_MODE, useValue: 'demo' },
        { provide: ActivityReadinessService, useValue: readinessStub },
      ],
    });
    const fixture = TestBed.createComponent(SettingsGeneral);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    // The section drops its private probe: opening it re-probes THROUGH
    // the shared service, and the gate signal is the service's own.
    expect(refresh).toHaveBeenCalled();
    interface IHookProto {
      activityHookInstalled(): boolean | null;
    }
    const proto = fixture.componentInstance as unknown as IHookProto;
    expect(proto.activityHookInstalled()).toBe(false);
    hook.set(true);
    expect(proto.activityHookInstalled()).toBe(true);
  });
});
