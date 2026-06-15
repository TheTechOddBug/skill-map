/**
 * `startWsHeartbeat` unit tests.
 *
 * Exercises the heartbeat against fake `ws` sockets / server, no real
 * WebSocket and no `createServer()`. Mirrors the broadcaster spec's
 * fake-driven style.
 *
 * Coverage targets:
 *   - Every connected client is pinged once per interval.
 *   - A client that pongs between ticks survives and keeps being pinged.
 *   - A client that misses a pong for a full interval is terminated.
 *   - `stop()` halts the loop and is idempotent.
 *   - A socket dropped from `wss.clients` is no longer pinged.
 */

import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { WebSocketServer } from 'ws';

import { startWsHeartbeat, WS_HEARTBEAT_INTERVAL_MS } from '../heartbeat.js';

/**
 * Fake `ws` socket: records `ping` / `terminate` and re-emits `pong`
 * through the EventEmitter the heartbeat subscribes to.
 */
class FakeSocket extends EventEmitter {
  pingCalls = 0;
  terminateCalls = 0;

  ping(): void {
    this.pingCalls += 1;
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  /** Simulate the browser's automatic pong reply. */
  pong(): void {
    this.emit('pong');
  }
}

/** Fake `WebSocketServer`: a tracked clients Set + the `connection` event. */
class FakeWss extends EventEmitter {
  readonly clients = new Set<FakeSocket>();

  /** Drive a new accepted upgrade: track the socket and fire `connection`. */
  connect(socket: FakeSocket): void {
    this.clients.add(socket);
    this.emit('connection', socket);
  }

  /** Drive a close: drop from the tracked set (mirrors the ws lib on 'close'). */
  drop(socket: FakeSocket): void {
    this.clients.delete(socket);
  }
}

function startOn(wss: FakeWss, intervalMs = WS_HEARTBEAT_INTERVAL_MS): ReturnType<typeof startWsHeartbeat> {
  return startWsHeartbeat(wss as unknown as WebSocketServer, { intervalMs });
}

describe('startWsHeartbeat', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setInterval'] });
  });

  afterEach(() => {
    mock.timers.reset();
    mock.restoreAll();
  });

  it('pings every connected client on each interval', () => {
    const wss = new FakeWss();
    const handle = startOn(wss, 1_000);
    const a = new FakeSocket();
    const b = new FakeSocket();
    wss.connect(a);
    wss.connect(b);

    mock.timers.tick(1_000);
    assert.equal(a.pingCalls, 1);
    assert.equal(b.pingCalls, 1);

    // Both pong, so both survive and get pinged again on the next tick.
    a.pong();
    b.pong();
    mock.timers.tick(1_000);
    assert.equal(a.pingCalls, 2);
    assert.equal(b.pingCalls, 2);
    assert.equal(a.terminateCalls, 0);
    assert.equal(b.terminateCalls, 0);

    handle.stop();
  });

  it('keeps a client that pongs between every tick alive indefinitely', () => {
    const wss = new FakeWss();
    const handle = startOn(wss, 1_000);
    const live = new FakeSocket();
    wss.connect(live);

    for (let i = 1; i <= 5; i += 1) {
      mock.timers.tick(1_000);
      assert.equal(live.pingCalls, i);
      assert.equal(live.terminateCalls, 0);
      live.pong();
    }

    handle.stop();
  });

  it('terminates a client that misses a pong for a full interval', () => {
    const wss = new FakeWss();
    const handle = startOn(wss, 1_000);
    const dead = new FakeSocket();
    wss.connect(dead);

    // First tick marks it not-alive and pings.
    mock.timers.tick(1_000);
    assert.equal(dead.pingCalls, 1);
    assert.equal(dead.terminateCalls, 0);

    // No pong arrives. The next tick finds it still not-alive → terminate.
    // (In production `terminate()` emits 'close', which the ws lib uses to
    // drop the socket from `wss.clients`, so it is not re-terminated.)
    mock.timers.tick(1_000);
    assert.equal(dead.terminateCalls, 1);
    // A peer pending termination is not pinged again on that tick.
    assert.equal(dead.pingCalls, 1);

    handle.stop();
  });

  it('stop() halts the ping loop and is idempotent', () => {
    const wss = new FakeWss();
    const handle = startOn(wss, 1_000);
    const s = new FakeSocket();
    wss.connect(s);

    mock.timers.tick(1_000);
    assert.equal(s.pingCalls, 1);

    handle.stop();
    handle.stop(); // idempotent, no throw
    mock.timers.tick(5_000);
    assert.equal(s.pingCalls, 1); // no further pings after stop
  });

  it('does not ping a socket that dropped out of wss.clients', () => {
    const wss = new FakeWss();
    const handle = startOn(wss, 1_000);
    const s = new FakeSocket();
    wss.connect(s);
    mock.timers.tick(1_000);
    assert.equal(s.pingCalls, 1);

    wss.drop(s);
    s.pong(); // even a late pong cannot resurrect it into the walk
    mock.timers.tick(1_000);
    assert.equal(s.pingCalls, 1);

    handle.stop();
  });
});
