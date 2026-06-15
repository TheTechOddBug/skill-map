/**
 * `WsEventStreamService`, RxJS-backed wrapper around the BFF's `/ws`
 * channel. Step 14.4.b consumer-side surface.
 *
 * Lifecycle
 * ---------
 *   - The constructor is cheap. It does NOT open a WebSocket.
 *   - The first subscriber to `events$` triggers `connect()` (when
 *     `mode === 'live'`; demo mode returns `EMPTY` and never opens a
 *     socket).
 *   - The stream is multicast: every subscriber receives every event
 *     while the socket stays open. Late subscribers do NOT replay past
 *     events (`bufferSize: 0`), they just start receiving from the next
 *     frame onward. This matches the broadcaster's contract on the BFF
 *     (server-push, no per-client replay).
 *   - On a normal close (RFC 6455 code 1000) we do NOT auto-reconnect:
 *     1000 is what `disconnect()` issues, the client itself decided to
 *     go away.
 *   - On any other close, INCLUDING 1001 ('going away') that the server
 *     issues during shutdown, we reconnect with exponential backoff:
 *     1s, 2s, 4s, 8s, 16s, capped at 30s. The backoff resets to 1s only
 *     after the socket stays open for `STABILITY_THRESHOLD_MS`, NOT on
 *     `onopen` (a connection that opens then immediately drops keeps
 *     escalating, see that constant for the flap-loop rationale). Cap at
 *     `MAX_RECONNECT_ATTEMPTS` total attempts before giving
 *     up. Giving up is NOT a stream error: the data subject stays alive
 *     and the `connectionState` signal flips to `'lost'`, so the UI can
 *     render a non-fatal "connection lost" banner with a manual
 *     `reconnect()`. Erroring the subject (the old behavior) tore down
 *     every subscriber and escaped to the global Sentry ErrorHandler as
 *     a false-positive Error on a routine `sm serve` shutdown. 1001 was
 *     previously treated as terminal too, but in practice the server
 *     issues it on every restart (`sm serve` hot-reload, container
 *     replacement, dev-loop save-and-rerun), and forcing the user to
 *     refresh the SPA every time was the larger UX cost.
 *
 * Connection state
 * ----------------
 *   `connectionState` is a readonly signal exposing the socket lifecycle
 *   as `'connecting' | 'open' | 'reconnecting' | 'lost'`. Consumers read
 *   it to drive UI affordances (the connection banner) and to re-seed
 *   via `/api/scan` on a reconnect (per `spec/cli-contract.md` §WebSocket
 *   protocol: treat `/ws` as a best-effort delta channel). It never
 *   leaves `'connecting'` in demo mode (the socket never opens).
 *
 * Concurrency / multicast strategy
 * --------------------------------
 *   We hold one long-lived `Subject<IWsEvent>` and one `Observable` view
 *   built with `share({ resetOnRefCountZero: false })`. When refcount
 *   drops to zero we DO keep the socket open until `disconnect()` is
 *   called explicitly, the EventLog and the CollectionLoader subscribe
 *   independently, and a transient navigation away from the EventLog
 *   shouldn't tear down the connection the loader still relies on.
 *
 *   The choice is documented because the alternative ("close on last
 *   unsubscribe") would teach the loader to re-trigger reconnect on
 *   every fresh subscribe, multiplying connect cost. Demo / test
 *   harnesses that need a clean socket call `disconnect()` explicitly.
 *
 * Wire shape
 * ----------
 *   The BFF sends one JSON object per text frame matching
 *   `IWsEventEnvelope` (see `src/server/events.ts`). The service runs
 *   `JSON.parse` + `isWsEvent()` on every frame; malformed frames are
 *   logged and dropped (no throw, a bad frame must not poison the
 *   stream).
 *
 * Demo-mode contract
 * ------------------
 *   `inject(SKILL_MAP_MODE) === 'demo'` ⇒ `events$` is `EMPTY` (completes
 *   immediately for every subscriber). `connect()` / `disconnect()` are
 *   no-ops. The service registers in DI so the data-source factory can
 *   inject it unconditionally.
 *
 * Why `WebSocket` is constructed via an indirection (`socketFactory`)
 * --------------------------------------------------------------------
 *   The default factory is `(url) => new WebSocket(url)` (browser API).
 *   The unit tests override this slot via the optional constructor
 *   argument, supplying a `FakeWebSocket` that simulates `onopen` /
 *   `onmessage` / `onclose` / `onerror`. Indirection lives at the
 *   boundary so production code never touches a mock.
 */

import { DestroyRef, InjectionToken, Injectable, OnDestroy, inject, signal } from '@angular/core';
import { EMPTY, Observable, Subject, share } from 'rxjs';
import { filter } from 'rxjs/operators';

import {
  isSidecarBumpedEvent,
  isWsEvent,
  type IWsEvent,
  type IWsScanCompletedEvent,
  type IWsSidecarBumpedEvent,
} from '../models/ws-event';
import { SKILL_MAP_MODE } from './data-source/runtime-mode';
import { WS_TEXTS } from '../i18n/ws.texts';

/** Backoff schedule (ms). Index = attempt number. After the last entry, we stay capped at 30s until `MAX_RECONNECT_ATTEMPTS`. */
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
/** Hard cap on consecutive reconnect attempts before we flip `connectionState` to `'lost'` and stop (no stream error). */
const MAX_RECONNECT_ATTEMPTS = 10;
/**
 * How long a socket must stay open before we treat it as *stable* and
 * reset the backoff counter. The reset deliberately does NOT happen on
 * `onopen`: a connection that opens and immediately drops (a flapping
 * proxy, a half-open upgrade) would otherwise reset the counter every
 * cycle, so it would never escalate the backoff and never reach `'lost'`.
 * That turns a flap into a tight 1s reconnect loop, and because the
 * loader re-seeds via `GET /api/scan` on every re-open, into a steady
 * scan-poll storm. Requiring a stable window before the reset makes each
 * flap count as a failed attempt, so the backoff grows and the loop
 * eventually surfaces a non-fatal `'lost'` banner instead. 10s is well
 * above any plausible flap and comfortably under the server's 30s
 * keep-alive ping, so a genuinely healthy socket always crosses it.
 */
const STABILITY_THRESHOLD_MS = 10_000;
/** RFC 6455 close codes that suppress the reconnect loop. Only 1000
 *  ('normal closure') qualifies: it's the code `disconnect()` issues
 *  when the client itself decided to tear down. Every other code
 *  (including 1001 'going away', which servers emit on every restart)
 *  triggers the reconnect backoff, so a `sm serve` reload reattaches
 *  the SPA without a manual page refresh. */
const NORMAL_CLOSE_CODES: ReadonlySet<number> = new Set([1000]);

/**
 * Socket lifecycle as observed by consumers:
 *   - `'connecting'`: initial state, or a manual `reconnect()` in flight.
 *   - `'open'`: the handshake completed; frames are flowing.
 *   - `'reconnecting'`: an abnormal close happened and a backoff retry is
 *     scheduled (transient; normal `sm serve` restarts pass through here).
 *   - `'lost'`: `MAX_RECONNECT_ATTEMPTS` exhausted. Terminal until the
 *     user triggers `reconnect()`. The data stream stays alive.
 */
export type TWsConnectionState = 'connecting' | 'open' | 'reconnecting' | 'lost';

/**
 * Minimal contract the service needs from a WebSocket implementation.
 * The browser `WebSocket` matches it natively; tests inject a fake.
 */
export interface IWsLike {
  readyState: number;
  close(code?: number, reason?: string): void;
  onopen: ((this: IWsLike, ev: unknown) => unknown) | null;
  onclose: ((this: IWsLike, ev: { code: number; reason: string }) => unknown) | null;
  onmessage: ((this: IWsLike, ev: { data: unknown }) => unknown) | null;
  onerror: ((this: IWsLike, ev: unknown) => unknown) | null;
}

/** Factory signature, `(url) => IWsLike`. Production: `new WebSocket(url)`. */
export type TWsSocketFactory = (url: string) => IWsLike;

/**
 * Build the `/ws` URL relative to the document origin. Works under both
 * `http://` (→ `ws://`) and `https://` (→ `wss://`). Always rooted at
 * `/ws` per the BFF route registered in `src/server/ws.ts`.
 */
function buildDefaultWsUrl(): string {
  // SSR / test rigs without a `window` use `127.0.0.1:4242` as a
  // defensive default. The service never tries to connect in test
  // because the spec injects a `mode` of its choosing.
  if (typeof window === 'undefined' || !window.location) {
    return 'ws://127.0.0.1:4242/ws';
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

/**
 * Injection token for the WebSocket constructor. Production resolves
 * to `(url) => new WebSocket(url)`; tests override via
 * `TestBed.overrideProvider(WS_SOCKET_FACTORY, { useValue: fakeFactory })`
 * (or by listing the override under `providers` before injecting
 * `WsEventStreamService`). The token lives at root scope so the
 * default fires when nothing overrides it.
 */
export const WS_SOCKET_FACTORY = new InjectionToken<TWsSocketFactory>(
  'WS_SOCKET_FACTORY',
  {
    providedIn: 'root',
    factory: () => (url: string) => new WebSocket(url) as unknown as IWsLike,
  },
);

/**
 * Injection token for the WebSocket target URL. Production resolves
 * to the page-relative `/ws` endpoint; tests override with a fixture
 * URL the fake factory recognises.
 */
export const WS_URL = new InjectionToken<string>('WS_URL', {
  providedIn: 'root',
  factory: () => buildDefaultWsUrl(),
});

@Injectable({ providedIn: 'root' })
export class WsEventStreamService implements OnDestroy {
  private readonly mode = inject(SKILL_MAP_MODE);
  private readonly destroyRef = inject(DestroyRef);

  private readonly subject = new Subject<IWsEvent>();
  private socket: IWsLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pending "connection stayed open long enough to be stable" timer. Resets the backoff when it fires; cleared on any close / teardown. */
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  /** Set true by `disconnect()` (and on `OnDestroy`). Suppresses any pending or future reconnect. */
  private disposed = false;

  /** Socket lifecycle, readable by consumers (connection banner, re-seed on reconnect). */
  private readonly _connectionState = signal<TWsConnectionState>('connecting');
  readonly connectionState = this._connectionState.asReadonly();

  /** Socket constructor + target URL. Both injected so tests can swap them via DI; see `WS_SOCKET_FACTORY` / `WS_URL`. */
  private readonly socketFactory = inject(WS_SOCKET_FACTORY);
  private readonly url = inject(WS_URL);

  /**
   * Multicast view of the underlying subject. Subscribing kicks the
   * socket open in live mode; subscribing in demo mode receives an
   * immediate `complete()` (via `EMPTY`).
   */
  readonly events$: Observable<IWsEvent>;

  /**
   * Pre-filtered stream of `scan.completed` envelopes. Centralised
   * here so consumers do not re-derive the same `.pipe(filter(...))`
   * each time, keeping the predicate canonical in one place.
   */
  readonly scanCompleted$: Observable<IWsScanCompletedEvent>;

  /**
   * Pre-filtered stream of `sidecar.bumped` envelopes, with full
   * payload-shape validation via `isSidecarBumpedEvent`.
   */
  readonly sidecarBumped$: Observable<IWsSidecarBumpedEvent>;

  constructor() {
    if (this.mode !== 'live') {
      // Demo mode: never open a socket. Subscribers see immediate
      // completion. The service still registers in DI so the factory
      // can inject it unconditionally.
      this.events$ = EMPTY;
    } else {
      // `share` with `resetOnRefCountZero: false` keeps the socket open
      // even after refcount drops to zero (see class docstring for the
      // tradeoff).
      this.events$ = new Observable<IWsEvent>((subscriber) => {
        // Side effect: connect on first interest. Re-subscribers reuse
        // the still-open socket and just attach to the subject below.
        if (!this.socket && !this.disposed) {
          this.connect();
        }
        const sub = this.subject.subscribe(subscriber);
        return () => sub.unsubscribe();
      }).pipe(share({ resetOnRefCountZero: false }));
    }

    this.scanCompleted$ = this.events$.pipe(
      filter((event): event is IWsScanCompletedEvent => event.type === 'scan.completed'),
    );
    this.sidecarBumped$ = this.events$.pipe(
      filter(isSidecarBumpedEvent),
    );

    // Best-effort cleanup on injector teardown (mirrors `disconnect()`
    // contract). Tests that construct outside DI must call `disconnect()`
    // explicitly because `DestroyRef` won't fire.
    this.destroyRef.onDestroy(() => this.disconnect());
  }

  /**
   * Tear down the socket cleanly: cancel any pending reconnect, close
   * the open socket with code 1000, and complete the subject so existing
   * subscribers see the natural end-of-stream signal.
   *
   * Idempotent, a second call is a no-op.
   */
  disconnect(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearStabilityTimer();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close(1000, 'client disconnect');
      } catch {
        // Ignore, the socket may already be closing / closed.
      }
      this.socket = null;
    }
    this.subject.complete();
  }

  /**
   * Manually re-open the socket after the reconnect loop gave up
   * (`connectionState === 'lost'`). Resets the attempt counter, flips
   * the state back to `'connecting'`, and reconnects immediately
   * (short-circuiting any pending backoff timer). Safe in any state: a
   * no-op while disposed or while a socket is already open / connecting.
   *
   * Because give-up never errors the data subject, reconnecting resumes
   * delivery to every existing subscriber without a re-subscribe.
   */
  reconnect(): void {
    if (this.disposed || this.socket) return;
    this.clearStabilityTimer();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this._connectionState.set('connecting');
    this.connect();
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private connect(): void {
    if (this.disposed) return;
    let socket: IWsLike;
    try {
      socket = this.socketFactory(this.url);
    } catch (err) {
      // `new WebSocket(...)` can throw synchronously (bad URL scheme,
      // SecurityError under mixed-content, etc.). Treat as an abnormal
      // failure and schedule a reconnect, the loop below will give up
      // after `MAX_RECONNECT_ATTEMPTS` total attempts.
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console -- developer log; UI shows watcher.error toast separately
      console.warn(WS_TEXTS.socketError(message));
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = (): void => {
      this._connectionState.set('open');
      // Reset the backoff only after the socket proves stable. Resetting
      // here (on `onopen`) would let a flapping connection clear the
      // counter every cycle, so it would never escalate the delay nor
      // reach 'lost', and the loader's re-seed on each re-open would
      // hammer `GET /api/scan` in a tight loop. See STABILITY_THRESHOLD_MS.
      this.clearStabilityTimer();
      this.stabilityTimer = setTimeout(() => {
        this.stabilityTimer = null;
        this.reconnectAttempt = 0;
      }, STABILITY_THRESHOLD_MS);
      // eslint-disable-next-line no-console -- developer log
      console.info(WS_TEXTS.connected(this.url));
    };

    socket.onmessage = (ev): void => {
      this.handleFrame(ev.data);
    };

    socket.onerror = (ev): void => {
      // Browsers don't expose a useful message on the error event, they
      // fire `onerror` then `onclose` back-to-back. Log a placeholder.
      const message =
        typeof ev === 'object' && ev !== null && 'message' in ev
          ? String((ev as { message?: unknown }).message ?? 'unknown')
          : 'unknown';
      // eslint-disable-next-line no-console -- developer log
      console.warn(WS_TEXTS.socketError(message));
    };

    socket.onclose = (ev): void => {
      // eslint-disable-next-line no-console -- developer log
      console.info(WS_TEXTS.closed(ev.code, ev.reason));
      this.socket = null;
      // A close before the stability window elapsed means this open did
      // NOT earn a backoff reset: cancel the pending reset so the attempt
      // count carries into scheduleReconnect() and the delay escalates.
      this.clearStabilityTimer();
      if (this.disposed) return;
      if (NORMAL_CLOSE_CODES.has(ev.code)) {
        // Client-initiated close (code 1000, from `disconnect()`). Do
        // NOT reconnect, the user / DI teardown asked us to go away.
        // Server-initiated 'going away' (1001) does NOT land here, it
        // falls through to `scheduleReconnect()` so a server restart
        // reattaches the SPA without a manual page refresh.
        return;
      }
      this.scheduleReconnect();
    };
  }

  private handleFrame(raw: unknown): void {
    if (typeof raw !== 'string') {
      // The BFF only sends text frames. Anything else (Blob, ArrayBuffer)
      // is unexpected, log and drop.
      // eslint-disable-next-line no-console -- developer log
      console.warn(WS_TEXTS.malformedFrame('non-string frame'));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console -- developer log
      console.warn(WS_TEXTS.malformedFrame(message));
      return;
    }
    if (!isWsEvent(parsed)) {
      // eslint-disable-next-line no-console -- developer log
      console.warn(WS_TEXTS.malformedFrame('envelope shape'));
      return;
    }
    this.subject.next(parsed);
  }

  /** Cancel a pending stability reset, if any. Called on every close and on teardown. */
  private clearStabilityTimer(): void {
    if (this.stabilityTimer !== null) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      // eslint-disable-next-line no-console -- developer log
      console.warn(WS_TEXTS.reconnectGiveUp(MAX_RECONNECT_ATTEMPTS));
      // Give up WITHOUT erroring the subject. The data stream stays
      // alive (so a later `reconnect()` resumes delivery to every
      // existing subscriber) and the connection state flips to `'lost'`,
      // which the connection banner renders as a non-fatal notice with a
      // manual Reconnect button. Erroring the subject here used to tear
      // down subscribers and surface a routine `sm serve` shutdown to
      // Sentry as an uncaught Error.
      this._connectionState.set('lost');
      return;
    }
    this._connectionState.set('reconnecting');
    const idx = Math.min(this.reconnectAttempt, BACKOFF_SCHEDULE_MS.length - 1);
    const delayMs = BACKOFF_SCHEDULE_MS[idx]!;
    this.reconnectAttempt += 1;
    // eslint-disable-next-line no-console -- developer log
    console.info(WS_TEXTS.reconnectScheduled(delayMs, this.reconnectAttempt));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  /**
   * Test seam, exposes the internal counter so a spec can assert that
   * a successful open resets backoff. Not part of the consumer-facing
   * API; the underscore signals "internal".
   */
  get _reconnectAttempt(): number {
    return this.reconnectAttempt;
  }
}
