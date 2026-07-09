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
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { log } from '../../kernel/util/logger.js';
import { MAX_MCP_SESSIONS } from '../limits.js';
import type { IMcpServerParts } from './mcp-server.js';

/** Supported HTTP verbs on `/mcp`. */
export type TMcpMethod = 'POST' | 'GET' | 'DELETE';

/** One live session: its transport, server, and subscription set. */
interface IMcpSession extends IMcpServerParts {
  transport: StreamableHTTPServerTransport;
}

/** JSON-RPC error codes used for transport-level rejections. */
const JSONRPC_SESSION_NOT_FOUND = -32001;
const JSONRPC_BAD_REQUEST = -32000;

export class McpSessionManager {
  readonly #sessions = new Map<string, IMcpSession>();
  #closed = false;

  /**
   * @param factory builds one session's `{ server, subscriptions }`
   *   (a fresh `McpServer` per `initialize`, see `createMcpServer`).
   */
  constructor(private readonly factory: () => IMcpServerParts) {}

  /** Number of live sessions. Read-only, for tests / diagnostics. */
  get sessionCount(): number {
    return this.#sessions.size;
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
        this.#sessions.set(id, { transport, server, subscriptions });
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
