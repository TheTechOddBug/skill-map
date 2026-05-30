import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SettingsPrivacy } from '../settings-privacy';
import {
  DATA_SOURCE,
  DataSourceError,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import type { IPreferencesApi, IPreferencesPatchApi } from '../../../../models/api';

/**
 * SettingsPrivacy coverage. The component mirrors SettingsGeneral's
 * fetch-on-visible / patch-on-toggle lifecycle, so the spec exercises:
 *   - `visible()` flipping to true triggers `getPreferences()`.
 *   - the toggle reads `telemetry.errorsEnabled` from the envelope.
 *   - flipping the toggle PATCHes `{ telemetry: { errorsEnabled } }` and
 *     replaces local state with the post-write envelope.
 *   - a failed save surfaces through `saveError` without throwing.
 *   - a failed load surfaces through `loadError`.
 *
 * The data-source is stubbed; assertions target the component's
 * imperative surface + the stub call shapes (matching the
 * settings-plugins spec, which keeps the test independent of PrimeNG's
 * overlay portal). The real `read` / `patch` functions live on the
 * component's `toggles[0]` def, so tests pull that def out rather than
 * fabricating one.
 */

function prefs(errorsEnabled: boolean): IPreferencesApi {
  return { updateCheck: { enabled: true }, telemetry: { errorsEnabled } };
}

interface IPrivacyToggleDefLike {
  key: 'telemetry.errorsEnabled';
  read(envelope: IPreferencesApi): boolean;
  patch(value: boolean): IPreferencesPatchApi;
}

interface IPrivacyProto {
  toggles: ReadonlyArray<IPrivacyToggleDefLike>;
  valueOf(def: IPrivacyToggleDefLike): boolean;
  onToggle(def: IPrivacyToggleDefLike, next: boolean): void;
  loadError(): string | null;
  saveError(): string | null;
}

interface IBootstrapResult {
  cmp: SettingsPrivacy;
  proto: IPrivacyProto;
  /** The component's real toggle def (carries `read` / `patch`). */
  def: IPrivacyToggleDefLike;
  fixture: ReturnType<typeof TestBed.createComponent<SettingsPrivacy>>;
}

function bootstrap(stub: Partial<IDataSourcePort>): IBootstrapResult {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
    ],
  });
  const fixture = TestBed.createComponent(SettingsPrivacy);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  const cmp = fixture.componentInstance;
  const proto = cmp as unknown as IPrivacyProto;
  const def = proto.toggles[0];
  if (!def) throw new Error('SettingsPrivacy has no toggle def to exercise');
  return { cmp, proto, def, fixture };
}

// Hop through two microtasks so the `effect` that calls `refresh()`
// resolves and the envelope signal is populated before assertions.
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SettingsPrivacy', () => {
  it('fetches preferences when the section becomes visible', async () => {
    const getPreferences = vi.fn().mockResolvedValue(prefs(false));
    const { proto, def, fixture } = bootstrap({ getPreferences, setPreferences: vi.fn() });

    expect(getPreferences).not.toHaveBeenCalled();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    expect(getPreferences).toHaveBeenCalledTimes(1);
    expect(proto.valueOf(def)).toBe(false);
  });

  it('reflects errorsEnabled=true from the envelope into the toggle value', async () => {
    const { proto, def, fixture } = bootstrap({
      getPreferences: vi.fn().mockResolvedValue(prefs(true)),
      setPreferences: vi.fn(),
    });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    expect(proto.valueOf(def)).toBe(true);
  });

  it('PATCHes telemetry.errorsEnabled on toggle and adopts the response', async () => {
    const getPreferences = vi.fn().mockResolvedValue(prefs(false));
    const setPreferences = vi.fn().mockResolvedValue(prefs(true));
    const { proto, def, fixture } = bootstrap({ getPreferences, setPreferences });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    proto.onToggle(def, true);
    await flushAsync();

    expect(setPreferences).toHaveBeenCalledTimes(1);
    expect(setPreferences).toHaveBeenCalledWith({ telemetry: { errorsEnabled: true } });
    expect(proto.valueOf(def)).toBe(true);
  });

  it('surfaces a failed save through saveError without throwing', async () => {
    const getPreferences = vi.fn().mockResolvedValue(prefs(false));
    const setPreferences = vi
      .fn()
      .mockRejectedValue(new DataSourceError('demo-readonly', 'nope'));
    const { proto, def, fixture } = bootstrap({ getPreferences, setPreferences });
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await flushAsync();

    proto.onToggle(def, true);
    await flushAsync();

    expect(proto.saveError()).toBe('nope');
    // The optimistic value never sticks on failure: state stays at the
    // last good envelope (errorsEnabled=false).
    expect(proto.valueOf(def)).toBe(false);
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
});
