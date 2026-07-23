import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SettingsGeneral } from '../settings-general';
import {
  DATA_SOURCE,
  DataSourceError,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
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

  it('the config-resolution button opens the nested dialog with layered rows', async () => {
    const getConfigResolution = vi.fn().mockResolvedValue([
      { key: 'scan.respectGitignore', value: true, layer: 'project', secret: false },
      { key: 'scan.strict', value: false, layer: 'defaults', secret: false },
    ]);
    const { fixture } = bootstrap({
      getPreferences: vi.fn().mockResolvedValue(prefs(true, false)),
      setPreferences: vi.fn(),
      getConfigResolution,
    });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();
    fixture.detectChanges();

    // Lazy: no fetch before the button opens the dialog.
    expect(getConfigResolution).not.toHaveBeenCalled();
    const btn = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="settings-general-config-resolution"] button',
    ) as HTMLButtonElement;
    btn.click();
    await flushAsync();
    fixture.detectChanges();

    expect(getConfigResolution).toHaveBeenCalledTimes(1);
    // The nested dialog renders via appendTo body under the test rig.
    const row = document.querySelector(
      '[data-testid="settings-config-resolution-row-scan.respectGitignore"]',
    );
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('scan.respectGitignore');
    expect(row!.textContent).toContain('true');
    expect(row!.querySelector('[data-layer="project"]')).not.toBeNull();
  });

});
