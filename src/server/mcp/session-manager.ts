/**
 * `McpSessionManager`, owns the set of live MCP sessions and routes raw
 * Node HTTP requests to the right `StreamableHTTPServerTransport`.
 *
 * STATEFUL mode (session ids) is required by the spec's realtime surface:
 * `resources.subscribe` + live `notifications/resources/updated` need the
 * persistent server → client GET SSE stream, which only exists in session
 * mode. Following the SDK's `sessions-state-scaling` pattern:
 *
 *   - `POST /mcp` with `isInitializeRequest(body)` and no session header
 *     → mint a new session (fresh transport + fresh `McpServer`), store
 *     it in the map via `onsessioninitialized`, route the request.
 *   - any request carrying a known `Mcp-Session-Id` → route to that
 *     session's transport.
 *   - `GET /mcp` opens the SSE stream; `DELETE /mcp` closes the session.
 *   - `transport.onclose` removes the session from the map.
 *
 * The map is bounded by `MAX_MCP_SESSIONS` (CWE-770): at the cap the
 * OLDEST session is evicted before a newcomer is admitted.
 *
 * Realtime fan-out (`notifyResourceUpdated` / `notifyResourceListChanged`)
 * is driven by the broadcaster sink (`sink.ts`); per-resource updates only
 * reach sessions that actually subscribed to the URI.
 *
 * A tracked session is NOT evidence that a client is attached: `onclose`
 * fires only on `DELETE /mcp` or shutdown, and a host that just goes away
 * (killed, crashed, or an orderly SDK-client `close()`, which aborts its
 * streams without sending `DELETE`) leaves the session behind. Liveness is
 * therefore VERIFIED by `sweepLiveSessions()`, the ping sweep contracted in
 * `spec/mcp-server.md` §Session liveness, which the `/api/mcp/status` probe
 * and the composition root's periodic timer both drive.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { EmptyResultSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { log } from '../../kernel/util/logger.js';
import { MAX_MCP_SESSIONS } from '../limits.js';
import type { IMcpServerParts } from './mcp-server.js';

/** Supported HTTP verbs on `/mcp`. */
export type TMcpMethod = 'POST' | 'GET' | 'DELETE';

/**
 * How long the server waits for a client to answer the liveness `ping`.
 * The base protocol requires a prompt answer and the peer is a local
 * process, so anything slower than this is a peer that is not there. It
 * doubles as the status probe's worst-case latency.
 */
export const MCP_PING_TIMEOUT_MS = 1_500;

/**
 * How long a session survives unreachability before it is reaped. Two
 * distinct hazards need this reprieve, and a single missed ping tells them
 * apart from a dead peer far too eagerly: a client that never opens the
 * `GET /mcp` stream cannot receive a ping at all, and one that is
 * reconnecting its stream has no stream to write to for that instant (the
 * transport drops the frame silently rather than failing). Reaping is
 * one-way, so a session is only reaped once it has been BOTH unreachable
 * and silent for this long.
 */
export const MCP_SESSION_GRACE_MS = 30_000;

/** Tuning seams for the liveness sweep. Tests shrink both. */
export interface IMcpSessionManagerOpts {
  /** Ping deadline (ms). Defaults to `MCP_PING_TIMEOUT_MS`. */
  pingTimeoutMs?: number;
  /** Post-activity reprieve (ms). Defaults to `MCP_SESSION_GRACE_MS`. */
  graceMs?: number;
}

/** One live session: its transport, server, and subscription set. */
interface IMcpSession extends IMcpServerParts {
  transport: StreamableHTTPServerTransport;
  /** Epoch-ms of the last request routed to this session, for the grace window. */
  lastSeenAt: number;
  /**
   * Epoch-ms of the first ping this session missed in the current run of
   * misses, `undefined` while it is answering. Reaping keys on the RUN,
   * not on one miss, so a momentary gap in the server → client stream
   * cannot kill a working session.
   */
  unreachableSince: number | undefined;
}

/** JSON-RPC error codes used for transport-level rejections. */
const JSONRPC_SESSION_NOT_FOUND = -32001;
const JSONRPC_BAD_REQUEST = -32000;

export class McpSessionManager {
  readonly #sessions = new Map<string, IMcpSession>();
  #closed = false;
  readonly #pingTimeoutMs: number;
  readonly #graceMs: number;
  /** The sweep in flight, so a Check landing mid-sweep joins it. */
  #sweep: Promise<number> | undefined;

  /**
   * @param factory builds one session's `{ server, subscriptions }`
   *   (a fresh `McpServer` per `initialize`, see `createMcpServer`).
   * @param opts liveness-sweep tuning (see `IMcpSessionManagerOpts`).
   */
  constructor(
    private readonly factory: () => IMcpServerParts,
    opts: IMcpSessionManagerOpts = {},
  ) {
    this.#pingTimeoutMs = opts.pingTimeoutMs ?? MCP_PING_TIMEOUT_MS;
    this.#graceMs = opts.graceMs ?? MCP_SESSION_GRACE_MS;
  }

  /**
   * Number of TRACKED sessions, which includes abandoned ones. Diagnostics
   * and tests only: never report this as "clients attached", that is what
   * `sweepLiveSessions()` is for.
   */
  get sessionCount(): number {
    return this.#sessions.size;
  }

  /**
   * Liveness sweep (`spec/mcp-server.md` §Session liveness): ping every
   * tracked session, return how many answered, and reap the ones that
   * failed with no recent traffic of their own. Concurrent callers (the
   * status route and the periodic timer) share one in-flight sweep.
   */
  async sweepLiveSessions(): Promise<number> {
    if (this.#closed) return 0;
    const inFlight = this.#sweep;
    if (inFlight !== undefined) return inFlight;
    const started = this.#runSweep();
    this.#sweep = started;
    try {
      return await started;
    } finally {
      if (this.#sweep === started) this.#sweep = undefined;
    }
  }

  /**
   * Route one raw Node request. The caller (the Hono `/mcp` handlers)
   * hands over `incoming` / `outgoing` and, for POST, the pre-parsed
   * JSON body (the Web Request body was already consumed by
   * `c.req.json()`, so the transport MUST receive `parsedBody`).
   */
  async handleRequest(
    method: TMcpMethod,
    incoming: IncomingMessage,
    outgoing: ServerResponse,
    parsedBody: unknown,
  ): Promise<void> {
    if (this.#closed) {
      writeJsonRpcError(outgoing, 503, JSONRPC_BAD_REQUEST, 'Server is shutting down');
      return;
    }

    const sessionId = headerValue(incoming.headers['mcp-session-id']);
    if (sessionId !== undefined) {
      const existing = this.#sessions.get(sessionId);
      if (existing) {
        existing.lastSeenAt = Date.now();
        await existing.transport.handleRequest(incoming, outgoing, parsedBody);
        return;
      }
      // Unknown session id: the client should start a new session.
      writeJsonRpcError(outgoing, 404, JSONRPC_SESSION_NOT_FOUND, 'Session not found');
      return;
    }

    if (method === 'POST' && isInitializeRequest(parsedBody)) {
      await this.#createSession(incoming, outgoing, parsedBody);
      return;
    }

    // No session header on a non-initialize request: malformed.
    writeJsonRpcError(outgoing, 400, JSONRPC_BAD_REQUEST, 'Bad Request: Mcp-Session-Id header required');
  }

  /**
   * Deliver `notifications/resources/updated` for `uri` to every session
   * that subscribed to it (spec §Real-time updates). Best-effort: a send
   * failure on one session never blocks the others.
   */
  notifyResourceUpdated(uri: string): void {
    for (const session of this.#sessions.values()) {
      if (session.subscriptions.has(uri)) {
        void session.server.server.sendResourceUpdated({ uri }).catch(() => {
          /* transport closing mid-notify; the onclose reaper cleans up */
        });
      }
    }
  }

  /**
   * Broadcast `notifications/resources/list_changed` to every session
   * (it advertises catalog change, not content, so it is not gated on
   * per-URI subscription).
   */
  notifyResourceListChanged(): void {
    for (const session of this.#sessions.values()) {
      try {
        session.server.server.sendResourceListChanged();
      } catch {
        /* best-effort */
      }
    }
  }

  /**
   * Close every live session (drains its SSE stream, rejects pending
   * requests) and refuse new sessions afterwards. Idempotent.
   */
  async closeAll(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const entries = Array.from(this.#sessions.values());
    this.#sessions.clear();
    for (const session of entries) {
      try {
        await session.transport.close();
      } catch {
        /* already closing / closed */
      }
    }
  }

  /**
   * One sweep pass. Sessions are probed in parallel: the deadline is the
   * same for all of them, so a serial walk would multiply the worst case
   * by the session count.
   */
  async #runSweep(): Promise<number> {
    const now = Date.now();
    const verdicts = await Promise.all(
      Array.from(this.#sessions.entries()).map(([id, session]) => this.#verify(id, session, now)),
    );
    return verdicts.filter(Boolean).length;
  }

  /**
   * Ping one session. A responder is live and clears its miss run; a
   * silent one never counts, but is only REAPED once it has been both
   * unreachable and silent for the whole grace window. Reaping is one-way
   * (the client's next request meets `Session not found`, which the
   * reference client surfaces as an error rather than re-initialising), so
   * the cost of holding a dead session one more sweep is nothing next to
   * the cost of cutting a live one.
   */
  async #verify(id: string, session: IMcpSession, now: number): Promise<boolean> {
    try {
      await session.server.server.request({ method: 'ping' }, EmptyResultSchema, {
        timeout: this.#pingTimeoutMs,
      });
      session.lastSeenAt = Date.now();
      session.unreachableSince = undefined;
      return true;
    } catch {
      session.unreachableSince ??= now;
      const silentFor = now - session.lastSeenAt;
      const unreachableFor = now - session.unreachableSince;
      if (silentFor < this.#graceMs || unreachableFor < this.#graceMs) return false;
      this.#sessions.delete(id);
      try {
        await session.transport.close();
      } catch {
        /* already closing / closed */
      }
      return false;
    }
  }

  async #createSession(
    incoming: IncomingMessage,
    outgoing: ServerResponse,
    parsedBody: unknown,
  ): Promise<void> {
    this.#evictIfAtCap();
    const { server, subscriptions } = this.factory();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.#sessions.set(id, {
          transport,
          server,
          subscriptions,
          lastSeenAt: Date.now(),
          unreachableSince: undefined,
        });
      },
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id !== undefined) this.#sessions.delete(id);
    };
    // Cast bridges a pure type-skew under `exactOptionalPropertyTypes:
    // true`: `StreamableHTTPServerTransport` exposes `onclose` as
    // `(() => void) | undefined` (getter/setter), while the SDK's
    // `Transport` interface declares `onclose?: () => void` (the strict
    // tsconfig treats the explicit `| undefined` as incompatible). The
    // class genuinely `implements Transport`, so the assertion is sound.
    // Mirrors the `WebSocketServerLike` cast in `server/index.ts`.
    await server.connect(transport as Transport);
    await transport.handleRequest(incoming, outgoing, parsedBody);
  }

  /**
   * Evict oldest-first until there is room for one more session. The map
   * is insertion-ordered, so the first key is the oldest. Closing the
   * transport also fires `onclose` (a no-op re-delete against the map we
   * already pruned).
   */
  #evictIfAtCap(): void {
    while (this.#sessions.size >= MAX_MCP_SESSIONS) {
      const oldest = this.#sessions.keys().next().value;
      if (oldest === undefined) break;
      const evicted = this.#sessions.get(oldest);
      this.#sessions.delete(oldest);
      log.warn(`mcp: session cap (${MAX_MCP_SESSIONS}) reached, evicting oldest session`);
      if (evicted) {
        void evicted.transport.close().catch(() => {
          /* already closing */
        });
      }
    }
  }
}

/** First value of a possibly-repeated header. */
function headerValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * Write a JSON-RPC error envelope directly to the raw Node response.
 * Used for transport-level rejections (unknown / missing session) so the
 * `/mcp` surface stays pure JSON-RPC instead of leaking the REST error
 * envelope. No-op if the response was already started.
 */
function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}
