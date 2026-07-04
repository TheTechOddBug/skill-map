import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import {
  WsEventStreamService,
  WS_SOCKET_FACTORY,
  WS_URL,
  type IWsLike,
} from '../ws-event-stream';
import { SKILL_MAP_MODE } from '../data-source/runtime-mode';
import type { IWsEvent } from '../../models/ws-event';

/**
 * Fake WebSocket, the service treats it as an `IWsLike`. The harness
 * exposes `simulateOpen()` / `simulateMessage(json)` / `simulateClose()`
 * / `simulateError()` so each test drives the lifecycle deterministically.
 */
class FakeWebSocket implements IWsLike {
  static readonly READY_OPEN = 1;
  static readonly READY_CLOSED = 3;

  readyState = 0;
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  onopen: ((this: IWsLike, ev: unknown) => unknown) | null = null;
  onclose: ((this: IWsLike, ev: { code: number; reason: string }) => unknown) | null = null;
  onmessage: ((this: IWsLike, ev: { data: unknown }) => unknown) | null = null;
  onerror: ((this: IWsLike, ev: unknown) => unknown) | null = null;

  constructor(public readonly url: string) {}

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.READY_CLOSED;
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.READY_OPEN;
    this.onopen?.call(this, {});
  }

  simulateMessage(payload: unknown): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.onmessage?.call(this, { data });
  }

  simulateRawMessage(data: unknown): void {
    this.onmessage?.call(this, { data });
  }

  simulateClose(code: number, reason = ''): void {
    this.readyState = FakeWebSocket.READY_CLOSED;
    this.onclose?.call(this, { code, reason });
  }

  simulateError(message = 'boom'): void {
    this.onerror?.call(this, { message });
  }
}

interface IHarness {
  service: WsEventStreamService;
  factory: ReturnType<typeof vi.fn>;
  sockets: FakeWebSocket[];
}

function createHarness(mode: 'live' | 'demo' = 'live'): IHarness {
  TestBed.resetTestingModule();
  const sockets: FakeWebSocket[] = [];
  const factory = vi.fn((url: string) => {
    const ws = new FakeWebSocket(url);
    sockets.push(ws);
    return ws;
  });
  // Inject the fake factory + URL via DI so the service never reaches
  // for the real `WebSocket` constructor. Order matters: TestBed must
  // see the providers before `inject(WsEventStreamService)` runs the
  // constructor's field initializers.
  TestBed.configureTestingModule({
    providers: [
      { provide: SKILL_MAP_MODE, useValue: mode },
      { provide: WS_SOCKET_FACTORY, useValue: factory },
      { provide: WS_URL, useValue: 'ws://test/ws' },
      WsEventStreamService,
    ],
  });
  const service = TestBed.inject(WsEventStreamService);
  return { service, factory, sockets };
}

describe('WsEventStreamService, lifecycle', () => {
  let harness: IHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    // Silence the developer console warnings under fake-timer churn.
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    harness?.service.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not open a socket until events$ has at least one subscriber', () => {
    harness = createHarness('live');
    expect(harness.factory).not.toHaveBeenCalled();
    expect(harness.sockets).toHaveLength(0);

    const sub = harness.service.events$.subscribe();
    expect(harness.factory).toHaveBeenCalledTimes(1);
    expect(harness.sockets).toHaveLength(1);
    sub.unsubscribe();
  });

  it('multicasts incoming frames to every active subscriber', () => {
    harness = createHarness('live');
    const a: IWsEvent[] = [];
    const b: IWsEvent[] = [];
    const subA = harness.service.events$.subscribe((e) => a.push(e));
    const subB = harness.service.events$.subscribe((e) => b.push(e));
    expect(harness.sockets).toHaveLength(1);

    harness.sockets[0]!.simulateOpen();
    harness.sockets[0]!.simulateMessage({
      type: 'scan.completed',
      timestamp: 123,
      runId: 'r-x',
      jobId: null,
      data: { nodes: 2, links: 0, issues: 0, durationMs: 5 },
    });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.type).toBe('scan.completed');
    subA.unsubscribe();
    subB.unsubscribe();
  });

  it('keeps the socket open after refcount drops to zero (resetOnRefCountZero: false)', () => {
    harness = createHarness('live');
    const sub = harness.service.events$.subscribe();
    expect(harness.sockets).toHaveLength(1);
    const ws = harness.sockets[0]!;
    sub.unsubscribe();
    // No close call, the service deliberately holds the socket open
    // so the next subscriber doesn't pay the reconnect cost.
    expect(ws.closeCalls).toHaveLength(0);
  });

  it('drops malformed JSON frames without throwing', () => {
    harness = createHarness('live');
    const received: IWsEvent[] = [];
    harness.service.events$.subscribe((e) => received.push(e));
    const ws = harness.sockets[0]!;
    ws.simulateOpen();
    ws.simulateMessage('not json {{{');
    ws.simulateMessage({ missingType: true, timestamp: 0, data: {} });
    expect(received).toHaveLength(0);

    ws.simulateMessage({ type: 'scan.started', timestamp: 1, data: {} });
    expect(received).toHaveLength(1);
  });

  it('drops non-string frames (Blob / ArrayBuffer) defensively', () => {
    harness = createHarness('live');
    const received: IWsEvent[] = [];
    harness.service.events$.subscribe((e) => received.push(e));
    harness.sockets[0]!.simulateOpen();
    harness.sockets[0]!.simulateRawMessage(new ArrayBuffer(8));
    expect(received).toHaveLength(0);
  });

  it('rejects an envelope with an empty type string', () => {
    harness = createHarness('live');
    const received: IWsEvent[] = [];
    harness.service.events$.subscribe((e) => received.push(e));
    harness.sockets[0]!.simulateOpen();
    harness.sockets[0]!.simulateMessage({ type: '', timestamp: 0, data: {} });
    expect(received).toHaveLength(0);
  });
});

describe('WsEventStreamService, scanActive (scan-in-progress flag)', () => {
  let harness: IHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    harness?.service.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const started = (): IWsEvent => ({ type: 'scan.started', timestamp: 1, data: {} });
  const completed = (): IWsEvent => ({
    type: 'scan.completed',
    timestamp: 2,
    runId: 'r-x',
    jobId: null,
    data: { nodes: 1, links: 0, issues: 0, durationMs: 1 },
  });

  it('flips true on scan.started and back to false on scan.completed', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    const ws = harness.sockets[0]!;
    ws.simulateOpen();

    expect(harness.service.scanActive()).toBe(false);
    ws.simulateMessage(started());
    expect(harness.service.scanActive()).toBe(true);
    ws.simulateMessage(completed());
    expect(harness.service.scanActive()).toBe(false);
  });

  it('resets to false on socket close so a scan cut short never sticks', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    const ws = harness.sockets[0]!;
    ws.simulateOpen();
    ws.simulateMessage(started());
    expect(harness.service.scanActive()).toBe(true);

    // Abnormal close mid-scan (e.g. an `sm serve` restart) clears the flag
    // so the topbar spinner does not spin forever waiting for a
    // `scan.completed` that the disconnect ate.
    ws.simulateClose(1001, 'going away');
    expect(harness.service.scanActive()).toBe(false);
  });
});

describe('WsEventStreamService, reconnect', () => {
  let harness: IHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    harness?.service.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports stableConnected only after the socket survives the stability window, clears it on close', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateOpen();
    // Just opened: NOT yet stable. A flap (open then drop < 10s) must not
    // count as stable, that is what stops the reconnect re-seed storm.
    expect(harness.service.stableConnected()).toBe(false);
    vi.advanceTimersByTime(9_999);
    expect(harness.service.stableConnected()).toBe(false);
    // The 10s stability window elapses: now stable.
    vi.advanceTimersByTime(1);
    expect(harness.service.stableConnected()).toBe(true);
    // An abnormal close drops the flag immediately.
    harness.sockets[0]!.simulateClose(1006);
    expect(harness.service.stableConnected()).toBe(false);
  });

  it('does NOT reconnect on a normal close (code 1000)', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateOpen();
    harness.sockets[0]!.simulateClose(1000, 'normal');

    vi.advanceTimersByTime(10_000);
    expect(harness.factory).toHaveBeenCalledTimes(1);
  });

  it('reconnects on a server-shutdown close (code 1001) so a sm serve restart reattaches', () => {
    // Regression: 1001 used to suppress the reconnect loop ('going
    // away' was treated as terminal), but `sm serve` emits 1001 on
    // every restart, hot-reload, dev-loop save-and-rerun, and the
    // SPA can't tell those apart from a deliberate stop. Forcing a
    // manual page refresh on every server tick was the larger UX
    // cost; the backoff still gives up after MAX_RECONNECT_ATTEMPTS
    // if the server stays down.
    harness = createHarness('live');
    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateOpen();
    harness.sockets[0]!.simulateClose(1001, 'going away');

    // First retry lands after the 1s backoff slot.
    expect(harness.factory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(harness.factory).toHaveBeenCalledTimes(2);
  });

  it('reconnects with exponential backoff on abnormal close (1006 → 1s, 2s, 4s, 8s, 16s, 30s cap)', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();

    // Attempt 1 → 1s
    harness.sockets[0]!.simulateClose(1006);
    expect(harness.factory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    expect(harness.factory).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(harness.factory).toHaveBeenCalledTimes(2);

    // Attempt 2 → 2s
    harness.sockets[1]!.simulateClose(1006);
    vi.advanceTimersByTime(2_000);
    expect(harness.factory).toHaveBeenCalledTimes(3);

    // Attempt 3 → 4s
    harness.sockets[2]!.simulateClose(1006);
    vi.advanceTimersByTime(4_000);
    expect(harness.factory).toHaveBeenCalledTimes(4);

    // Attempt 4 → 8s
    harness.sockets[3]!.simulateClose(1006);
    vi.advanceTimersByTime(8_000);
    expect(harness.factory).toHaveBeenCalledTimes(5);

    // Attempt 5 → 16s
    harness.sockets[4]!.simulateClose(1006);
    vi.advanceTimersByTime(16_000);
    expect(harness.factory).toHaveBeenCalledTimes(6);

    // Attempt 6 → cap at 30s
    harness.sockets[5]!.simulateClose(1006);
    vi.advanceTimersByTime(29_999);
    expect(harness.factory).toHaveBeenCalledTimes(6);
    vi.advanceTimersByTime(1);
    expect(harness.factory).toHaveBeenCalledTimes(7);
  });

  it('resets backoff only after the socket stays open for the stability window', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateClose(1006); // attempt 1 scheduled (1s)
    vi.advanceTimersByTime(1_000);
    expect(harness.factory).toHaveBeenCalledTimes(2);
    expect(harness.service._reconnectAttempt).toBe(1);

    // A successful open does NOT reset the counter immediately, the
    // connection has to survive the stability window first.
    harness.sockets[1]!.simulateOpen();
    expect(harness.service._reconnectAttempt).toBe(1);

    // After staying open for STABILITY_THRESHOLD_MS (10s) the reset fires.
    vi.advanceTimersByTime(10_000);
    expect(harness.service._reconnectAttempt).toBe(0);

    // Next abnormal close starts the schedule from 1s again, not 2s.
    harness.sockets[1]!.simulateClose(1006);
    vi.advanceTimersByTime(1_000);
    expect(harness.factory).toHaveBeenCalledTimes(3);
  });

  it('does NOT reset backoff on a flapping open (open then immediate close escalates to lost)', () => {
    // Regression: onopen used to reset reconnectAttempt to 0 immediately,
    // so a socket that opened then dropped before the stability window
    // cleared the counter every cycle, looping at 1s forever and (via the
    // loader's re-seed on each re-open) hammering GET /api/scan. Now an
    // open that does not survive the stability window counts as a failed
    // attempt, so the backoff escalates and the loop terminates in 'lost'.
    harness = createHarness('live');
    harness.service.events$.subscribe();

    for (let i = 0; i < 11; i += 1) {
      const ws = harness.sockets[i]!;
      ws.simulateOpen();
      // Drop after 1s, far short of STABILITY_THRESHOLD_MS (10s), so the
      // pending reset is cancelled and the attempt count carries forward.
      vi.advanceTimersByTime(1_000);
      ws.simulateClose(1006);
      // Let the scheduled reconnect fire (the 30s cap covers every slot).
      vi.advanceTimersByTime(30_000);
      expect(harness.service._reconnectAttempt).toBe(Math.min(i + 1, 10));
    }

    expect(harness.service.connectionState()).toBe('lost');
  });

  it('gives up after MAX_RECONNECT_ATTEMPTS WITHOUT erroring the stream (connectionState → lost)', () => {
    harness = createHarness('live');
    let receivedError: unknown = null;
    let completed = false;
    harness.service.events$.subscribe({
      next: () => undefined,
      error: (err) => {
        receivedError = err;
      },
      complete: () => {
        completed = true;
      },
    });

    // Burn through all 10 attempts.
    for (let i = 0; i < 10; i += 1) {
      const ws = harness.sockets[i]!;
      ws.simulateClose(1006);
      // Use the cap (30s) to make sure each scheduled reconnect fires
      // even after the schedule plateau.
      vi.advanceTimersByTime(30_000);
    }
    // Eleventh close → exceeded; service gives up.
    harness.sockets[10]!.simulateClose(1006);

    // The give-up does NOT error or complete the subject: subscribers
    // stay attached so a later reconnect() resumes delivery. The failure
    // surfaces only via the connectionState signal (the banner reads it).
    expect(receivedError).toBeNull();
    expect(completed).toBe(false);
    expect(harness.service.connectionState()).toBe('lost');
  });

  it('tracks connectionState across the lifecycle (connecting → open → reconnecting → lost)', () => {
    harness = createHarness('live');
    expect(harness.service.connectionState()).toBe('connecting');

    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateOpen();
    expect(harness.service.connectionState()).toBe('open');

    harness.sockets[0]!.simulateClose(1006);
    expect(harness.service.connectionState()).toBe('reconnecting');

    // Exhaust the remaining attempts: each plateau tick fires a reconnect
    // whose close advances the counter until the cap trips.
    for (let i = 1; i <= 10; i += 1) {
      vi.advanceTimersByTime(30_000);
      harness.sockets[i]!.simulateClose(1006);
    }
    expect(harness.service.connectionState()).toBe('lost');
  });

  it('reconnect() resets the backoff, returns to connecting, and resumes delivery after giving up', () => {
    harness = createHarness('live');
    const received: IWsEvent[] = [];
    harness.service.events$.subscribe((e) => received.push(e));

    // Drive the loop to exhaustion → 'lost'.
    for (let i = 0; i < 11; i += 1) {
      harness.sockets[i]!.simulateClose(1006);
      vi.advanceTimersByTime(30_000);
    }
    expect(harness.service.connectionState()).toBe('lost');
    const socketsBefore = harness.sockets.length;

    // Manual reconnect opens a fresh socket immediately and resets state.
    harness.service.reconnect();
    expect(harness.service.connectionState()).toBe('connecting');
    expect(harness.service._reconnectAttempt).toBe(0);
    expect(harness.sockets).toHaveLength(socketsBefore + 1);

    // The new socket opens and frames flow to the ORIGINAL subscriber,
    // proving the subject was never torn down on give-up.
    const fresh = harness.sockets[harness.sockets.length - 1]!;
    fresh.simulateOpen();
    expect(harness.service.connectionState()).toBe('open');
    fresh.simulateMessage({ type: 'scan.started', timestamp: 1, data: {} });
    expect(received).toHaveLength(1);
  });
});

describe('WsEventStreamService, disconnect', () => {
  let harness: IHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes the open socket with code 1000 and completes the stream', () => {
    harness = createHarness('live');
    let completed = false;
    harness.service.events$.subscribe({ complete: () => (completed = true) });
    harness.sockets[0]!.simulateOpen();

    harness.service.disconnect();
    expect(harness.sockets[0]!.closeCalls).toEqual([{ code: 1000, reason: 'client disconnect' }]);
    expect(completed).toBe(true);
  });

  it('cancels a pending reconnect timer', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateClose(1006); // schedules reconnect

    harness.service.disconnect();
    vi.advanceTimersByTime(60_000);
    // Only the original socket was created; reconnect was cancelled.
    expect(harness.factory).toHaveBeenCalledTimes(1);
  });

  it('is idempotent, second call is a no-op', () => {
    harness = createHarness('live');
    harness.service.events$.subscribe();
    harness.sockets[0]!.simulateOpen();

    harness.service.disconnect();
    harness.service.disconnect();
    expect(harness.sockets[0]!.closeCalls).toHaveLength(1);
  });
});

describe('WsEventStreamService, demo mode', () => {
  let harness: IHarness;

  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    harness?.service.disconnect();
    vi.restoreAllMocks();
  });

  it('returns EMPTY (immediate complete) and never opens a socket', () => {
    harness = createHarness('demo');
    let nextCalls = 0;
    let completed = false;
    harness.service.events$.subscribe({
      next: () => (nextCalls += 1),
      complete: () => (completed = true),
    });
    expect(nextCalls).toBe(0);
    expect(completed).toBe(true);
    expect(harness.factory).not.toHaveBeenCalled();
  });

  it('disconnect() is a safe no-op in demo mode', () => {
    harness = createHarness('demo');
    expect(() => harness.service.disconnect()).not.toThrow();
  });

  it('connectionState stays "connecting" (never opens) so the banner gate stays off', () => {
    harness = createHarness('demo');
    harness.service.events$.subscribe();
    expect(harness.factory).not.toHaveBeenCalled();
    expect(harness.service.connectionState()).toBe('connecting');
  });
});

describe('WsEventStreamService, live-updates switch (Settings toggle)', () => {
  const WS_ENABLED_KEY = 'sm.live.ws-enabled';
  let harness: IHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    harness?.service.disconnect();
    localStorage.removeItem(WS_ENABLED_KEY);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('boots with the switch OFF: no socket on subscribe, state "disabled"', () => {
    localStorage.setItem(WS_ENABLED_KEY, 'false');
    harness = createHarness('live');
    const sub = harness.service.events$.subscribe();
    expect(harness.factory).not.toHaveBeenCalled();
    expect(harness.service.connectionState()).toBe('disabled');
    sub.unsubscribe();
  });

  it('setEnabled(false) closes the open socket with a normal 1000 and never reconnects', () => {
    harness = createHarness('live');
    const sub = harness.service.events$.subscribe();
    const ws = harness.sockets[0]!;
    ws.simulateOpen();
    expect(harness.service.connectionState()).toBe('open');

    harness.service.setEnabled(false);
    expect(ws.closeCalls).toEqual([{ code: 1000, reason: 'live updates disabled' }]);
    expect(harness.service.connectionState()).toBe('disabled');
    // The normal close must not schedule a retry, even hours later.
    ws.simulateClose(1000, 'live updates disabled');
    vi.advanceTimersByTime(120_000);
    expect(harness.factory).toHaveBeenCalledTimes(1);
    expect(harness.service.connectionState()).toBe('disabled');
    sub.unsubscribe();
  });

  it('setEnabled(false) cancels a pending reconnect loop', () => {
    harness = createHarness('live');
    const sub = harness.service.events$.subscribe();
    harness.sockets[0]!.simulateOpen();
    harness.sockets[0]!.simulateClose(1006);
    expect(harness.service.connectionState()).toBe('reconnecting');

    harness.service.setEnabled(false);
    expect(harness.service.connectionState()).toBe('disabled');
    vi.advanceTimersByTime(120_000);
    expect(harness.factory).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it('setEnabled(true) reconnects immediately when a subscriber is attached, and frames resume', () => {
    harness = createHarness('live');
    const seen: IWsEvent[] = [];
    const sub = harness.service.events$.subscribe((e) => seen.push(e));
    harness.sockets[0]!.simulateOpen();
    harness.service.setEnabled(false);
    harness.sockets[0]!.simulateClose(1000, 'live updates disabled');

    harness.service.setEnabled(true);
    expect(harness.factory).toHaveBeenCalledTimes(2);
    expect(harness.service.connectionState()).toBe('connecting');
    const ws2 = harness.sockets[1]!;
    ws2.simulateOpen();
    expect(harness.service.connectionState()).toBe('open');
    ws2.simulateMessage({
      type: 'scan.completed',
      timestamp: 123,
      runId: 'r-x',
      jobId: null,
      data: { nodes: 2, links: 0, issues: 0, durationMs: 5 },
    });
    // Delivery resumes on the SAME subscription: the suspend never
    // completed the subject.
    expect(seen).toHaveLength(1);
    sub.unsubscribe();
  });

  it('setEnabled(true) without prior interest stays lazy (no socket until first subscriber)', () => {
    localStorage.setItem(WS_ENABLED_KEY, 'false');
    harness = createHarness('live');
    harness.service.setEnabled(true);
    expect(harness.factory).not.toHaveBeenCalled();
    const sub = harness.service.events$.subscribe();
    expect(harness.factory).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it('reconnect() is a no-op while the switch is off (banner path cannot bypass it)', () => {
    localStorage.setItem(WS_ENABLED_KEY, 'false');
    harness = createHarness('live');
    const sub = harness.service.events$.subscribe();
    harness.service.reconnect();
    expect(harness.factory).not.toHaveBeenCalled();
    expect(harness.service.connectionState()).toBe('disabled');
    sub.unsubscribe();
  });
});
