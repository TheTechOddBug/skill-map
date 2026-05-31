import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ConnectionBanner } from '../connection-banner';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import {
  WsEventStreamService,
  type TWsConnectionState,
} from '../../../../services/ws-event-stream';

/**
 * The banner only reads `connectionState()` and calls `reconnect()`, so
 * a minimal stub (a writable signal + a spy) stands in for the full
 * service. Casting through `unknown` keeps the stub tiny without
 * implementing the rest of the service surface.
 */
function makeFixture(mode: 'live' | 'demo', state: TWsConnectionState) {
  const connectionState = signal<TWsConnectionState>(state);
  const reconnect = vi.fn();
  const wsStub = { connectionState, reconnect } as unknown as WsEventStreamService;

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ConnectionBanner],
    providers: [
      { provide: SKILL_MAP_MODE, useValue: mode },
      { provide: WsEventStreamService, useValue: wsStub },
    ],
  });
  const fixture = TestBed.createComponent(ConnectionBanner);
  fixture.detectChanges();
  return { fixture, connectionState, reconnect };
}

function bannerEl(fixture: ReturnType<typeof makeFixture>['fixture']): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector('[data-testid="connection-banner"]');
}

describe('ConnectionBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders when mode is live and the connection is lost', () => {
    const { fixture } = makeFixture('live', 'lost');
    expect(bannerEl(fixture)).not.toBeNull();
  });

  it('stays hidden while the connection is healthy or merely reconnecting', () => {
    for (const state of ['connecting', 'open', 'reconnecting'] as TWsConnectionState[]) {
      const { fixture } = makeFixture('live', state);
      expect(bannerEl(fixture)).toBeNull();
    }
  });

  it('stays hidden in demo mode even when state is lost (mode gate)', () => {
    const { fixture } = makeFixture('demo', 'lost');
    expect(bannerEl(fixture)).toBeNull();
  });

  it('self-hides when the connection is restored', () => {
    const { fixture, connectionState } = makeFixture('live', 'lost');
    expect(bannerEl(fixture)).not.toBeNull();
    connectionState.set('open');
    fixture.detectChanges();
    expect(bannerEl(fixture)).toBeNull();
  });

  it('calls WsEventStreamService.reconnect() when the Reconnect button is clicked', () => {
    const { fixture, reconnect } = makeFixture('live', 'lost');
    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="connection-banner-reconnect"]',
    );
    expect(btn).not.toBeNull();
    btn!.click();
    expect(reconnect).toHaveBeenCalledTimes(1);
  });
});
