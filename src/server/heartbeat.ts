/**
 * `startWsHeartbeat`, transport-level keep-alive + dead-peer detection
 * for the `/ws` channel.
 *
 * Why this exists
 * ---------------
 *   The `WsBroadcaster` only writes to a socket when the kernel emits a
 *   `scan.*` / `action.applied` event. An idle workspace (no file
 *   changes) produces no frames for minutes at a time. Any proxy or load
 *   balancer between the SPA and the BFF (the Angular dev-server proxy in
 *   `pnpm dev`, a hosted nginx / ALB idle timeout) silently drops a
 *   WebSocket that goes quiet. The drop reaches the SPA as an abnormal
 *   close, which kicks its reconnect loop; with no server keep-alive that
 *   cycle repeats and each re-open re-seeds via `GET /api/scan`, turning
 *   an idle tab into a steady poll storm.
 *
 *   RFC 6455 ping/pong control frames fix this at the transport layer:
 *   the periodic ping keeps the connection non-idle (proxies leave it
 *   alone) and the browser answers every ping with an automatic pong
 *   WITHOUT surfacing anything to the page's `WebSocket` JS API. So this
 *   needs no client code and no change to the JSON event envelope.
 *
 *   The same ping doubles as dead-peer detection: a half-open socket
 *   (peer vanished without a close frame, e.g. host sleep, NAT timeout)
 *   never pongs, so the next tick terminates it. That complements the
 *   broadcaster's `bufferedAmount` eviction, which only fires when there
 *   is an event to send.
 *
 * Mechanism (canonical `ws` pattern)
 * ----------------------------------
 *   - On every new connection (`wss.emit('connection', ...)`, fired by
 *     `@hono/node-server` after the upgrade), mark the socket alive and
 *     flip it back to alive on each `pong`.
 *   - Every `intervalMs`, walk `wss.clients`: terminate any socket that
 *     has not ponged since the previous tick, then mark the rest
 *     not-alive and ping them. A live peer pongs before the next tick and
 *     survives.
 *   - Aliveness lives in a `WeakMap` keyed by the socket, never on the
 *     socket object, so we add no enumerable property to a `ws` type we
 *     don't own and the entry is GC'd with the socket.
 *
 *   The interval is `unref()`-ed so it never keeps the Node process alive
 *   on its own; graceful shutdown closes sockets via the broadcaster and
 *   stops the timer via the returned `stop()`.
 *
 * This lives at the composition root (wired in `index.ts`) rather than in
 * `ws.ts` because it is a transport concern over the raw `ws` sockets the
 * `WebSocketServer` already tracks, orthogonal to the broadcaster's
 * application-event fan-out and to the route's broadcaster registration.
 */

import type { WebSocket, WebSocketServer } from 'ws';

/**
 * Ping cadence. 30s sits comfortably under the idle-timeout most proxies
 * and load balancers enforce (commonly 60s), so a quiet connection always
 * sees at least one ping before any intermediary would consider it idle.
 * Tuning is unsupported pre-v1.
 */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

export interface IWsHeartbeatHandle {
  /** Stop pinging and detach the connection listener. Idempotent. */
  stop(): void;
}

export interface IStartWsHeartbeatOpts {
  /** Override the ping cadence (ms). Defaults to `WS_HEARTBEAT_INTERVAL_MS`. */
  intervalMs?: number;
}

/**
 * Begin the heartbeat over `wss`. Returns a handle whose `stop()` the
 * composition root calls during graceful shutdown (before the broadcaster
 * drains clients with code 1001).
 */
export function startWsHeartbeat(
  wss: WebSocketServer,
  opts: IStartWsHeartbeatOpts = {},
): IWsHeartbeatHandle {
  const intervalMs = opts.intervalMs ?? WS_HEARTBEAT_INTERVAL_MS;
  // Per-socket liveness. WeakMap so a closed socket's entry is collected
  // automatically and we never mutate the `ws` WebSocket object.
  const alive = new WeakMap<WebSocket, boolean>();

  const onConnection = (socket: WebSocket): void => {
    alive.set(socket, true);
    socket.on('pong', () => {
      alive.set(socket, true);
    });
  };
  wss.on('connection', onConnection);

  const timer = setInterval(() => {
    for (const socket of wss.clients) {
      if (alive.get(socket) === false) {
        // No pong since the previous tick: the peer is gone. Terminate
        // hard (no close handshake, the socket is already dead); the
        // route's `onClose` then unregisters it from the broadcaster.
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      try {
        socket.ping();
      } catch {
        // `ping()` can throw if the socket flipped to CLOSING between the
        // `wss.clients` read and here. The next tick (or the close
        // handler) reaps it; nothing to do.
      }
    }
  }, intervalMs);
  // Never let the heartbeat alone hold the event loop open.
  timer.unref?.();

  let stopped = false;
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      wss.off('connection', onConnection);
    },
  };
}
