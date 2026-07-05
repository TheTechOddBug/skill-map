import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { LivePreferencesService } from '../live-preferences';

const WS_KEY = 'sm.live.ws-enabled';
const ACTIVITY_KEY = 'sm.live.activity-enabled';
const FOLLOW_KEY = 'sm.live.follow-activity';

function clearStored(): void {
  localStorage.removeItem(WS_KEY);
  localStorage.removeItem(ACTIVITY_KEY);
  localStorage.removeItem(FOLLOW_KEY);
}

function bootstrap(): LivePreferencesService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [LivePreferencesService] });
  return TestBed.inject(LivePreferencesService);
}

describe('LivePreferencesService', () => {
  beforeEach(clearStored);
  afterEach(clearStored);

  it('defaults both switches to ON when nothing is stored', () => {
    const service = bootstrap();
    expect(service.wsEnabled()).toBe(true);
    expect(service.activityEnabled()).toBe(true);
  });

  it('reads a stored OFF at construction', () => {
    localStorage.setItem(WS_KEY, 'false');
    localStorage.setItem(ACTIVITY_KEY, 'false');
    const service = bootstrap();
    expect(service.wsEnabled()).toBe(false);
    expect(service.activityEnabled()).toBe(false);
  });

  it('persists setter writes so the next session reads them back', () => {
    const service = bootstrap();
    service.setWsEnabled(false);
    service.setActivityEnabled(false);
    expect(localStorage.getItem(WS_KEY)).toBe('false');
    expect(localStorage.getItem(ACTIVITY_KEY)).toBe('false');
    expect(service.wsEnabled()).toBe(false);
    expect(service.activityEnabled()).toBe(false);

    service.setWsEnabled(true);
    expect(localStorage.getItem(WS_KEY)).toBe('true');
    expect(service.wsEnabled()).toBe(true);
  });

  it('falls back to the default on a malformed stored value', () => {
    localStorage.setItem(WS_KEY, 'banana');
    const service = bootstrap();
    expect(service.wsEnabled()).toBe(true);
  });

  it('defaults follow-the-activity to OFF when nothing is stored', () => {
    const service = bootstrap();
    expect(service.followActivityEnabled()).toBe(false);
  });

  it('reads a stored follow-the-activity ON at construction and persists setter writes', () => {
    localStorage.setItem(FOLLOW_KEY, 'true');
    const service = bootstrap();
    expect(service.followActivityEnabled()).toBe(true);

    service.setFollowActivityEnabled(false);
    expect(localStorage.getItem(FOLLOW_KEY)).toBe('false');
    expect(service.followActivityEnabled()).toBe(false);

    service.setFollowActivityEnabled(true);
    expect(localStorage.getItem(FOLLOW_KEY)).toBe('true');
    expect(service.followActivityEnabled()).toBe(true);
  });
});
