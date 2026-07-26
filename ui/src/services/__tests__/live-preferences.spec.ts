import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { LivePreferencesService } from '../live-preferences';
import { DATA_SOURCE, type IDataSourcePort } from '../data-source/data-source.port';
import type { IProjectPreferencesApi } from '../../models/api';

const WS_KEY = 'sm.live.ws-enabled';
const ACTIVITY_KEY = 'sm.live.activity-enabled';
const FOLLOW_KEY = 'sm.live.follow-activity';

function clearStored(): void {
  localStorage.removeItem(WS_KEY);
  localStorage.removeItem(ACTIVITY_KEY);
  localStorage.removeItem(FOLLOW_KEY);
}

function prefsEnvelope(ui?: IProjectPreferencesApi['ui']): IProjectPreferencesApi {
  return {
    allowSidecarWriters: true,
    scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
    tutorialReminderStep: 0,
    ...(ui ? { ui } : {}),
  };
}

function bootstrap(stub: Partial<IDataSourcePort> = {}): LivePreferencesService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [LivePreferencesService, { provide: DATA_SOURCE, useValue: stub }],
  });
  return TestBed.inject(LivePreferencesService);
}

describe('LivePreferencesService', () => {
  beforeEach(clearStored);
  afterEach(clearStored);

  it('defaults both live switches to ON before and after an empty load', async () => {
    const service = bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefsEnvelope()),
    });
    expect(service.wsEnabled()).toBe(true);
    expect(service.activityEnabled()).toBe(true);
    await service.load();
    expect(service.wsEnabled()).toBe(true);
    expect(service.activityEnabled()).toBe(true);
  });

  it('load() adopts the persisted ui.* preferences from the server', async () => {
    const service = bootstrap({
      getProjectPreferences: vi
        .fn()
        .mockResolvedValue(prefsEnvelope({ liveUpdates: false, realtimeActivity: false })),
    });
    await service.load();
    expect(service.wsEnabled()).toBe(false);
    expect(service.activityEnabled()).toBe(false);
  });

  it('load() keeps the ON defaults when the fetch fails', async () => {
    const service = bootstrap({
      getProjectPreferences: vi.fn().mockRejectedValue(new Error('offline')),
    });
    await service.load();
    expect(service.wsEnabled()).toBe(true);
    expect(service.activityEnabled()).toBe(true);
  });

  it('load() ignores stale pre-move localStorage values (server is the only source)', async () => {
    localStorage.setItem(WS_KEY, 'false');
    localStorage.setItem(ACTIVITY_KEY, 'false');
    const service = bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefsEnvelope()),
    });
    await service.load();
    expect(service.wsEnabled()).toBe(true);
    expect(service.activityEnabled()).toBe(true);
  });

  it('setter writes PATCH the project preferences (write-behind)', async () => {
    const setProjectPreferences = vi.fn().mockResolvedValue(prefsEnvelope());
    const service = bootstrap({ setProjectPreferences });

    service.setWsEnabled(false);
    expect(service.wsEnabled()).toBe(false);
    expect(setProjectPreferences).toHaveBeenCalledWith({ ui: { liveUpdates: false } });

    service.setActivityEnabled(false);
    expect(service.activityEnabled()).toBe(false);
    expect(setProjectPreferences).toHaveBeenCalledWith({
      ui: { realtimeActivity: false },
    });

    // No-op writes (same value) do not PATCH again.
    setProjectPreferences.mockClear();
    service.setWsEnabled(false);
    expect(setProjectPreferences).not.toHaveBeenCalled();
  });

  it('a failed PATCH keeps the flipped signal (write-behind, logged only)', async () => {
    const setProjectPreferences = vi.fn().mockRejectedValue(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = bootstrap({ setProjectPreferences });

    service.setWsEnabled(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.wsEnabled()).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('defaults follow-the-activity to ON when nothing is stored (user call 2026-07-26)', () => {
    const service = bootstrap();
    expect(service.followActivityEnabled()).toBe(true);
  });

  it('reads a stored follow-the-activity OFF at construction and persists setter writes', () => {
    localStorage.setItem(FOLLOW_KEY, 'false');
    const service = bootstrap();
    expect(service.followActivityEnabled()).toBe(false);
    service.setFollowActivityEnabled(true);
    expect(localStorage.getItem(FOLLOW_KEY)).toBe('true');
    expect(service.followActivityEnabled()).toBe(true);

    service.setFollowActivityEnabled(false);
    expect(localStorage.getItem(FOLLOW_KEY)).toBe('false');
    expect(service.followActivityEnabled()).toBe(false);

    service.setFollowActivityEnabled(true);
    expect(localStorage.getItem(FOLLOW_KEY)).toBe('true');
    expect(service.followActivityEnabled()).toBe(true);
  });
});
