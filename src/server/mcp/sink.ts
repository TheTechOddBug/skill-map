/**
 * `createMcpBroadcasterSink(manager)`, the passive bridge from the
 * in-process `WsBroadcaster` stream to MCP notifications (spec
 * §Real-time updates).
 *
 * The MCP server does NOT run a second watcher: it registers a synthetic
 * `IBroadcasterClient` on the ONE `WsBroadcaster` that already feeds the
 * Web UI over `/ws`, and translates the WS envelopes it receives into MCP
 * `notifications/resources/*`:
 *
 *   - `scan.completed`            → `resources/updated` for
 *                                   `skillmap://graph` + `skillmap://issues`,
 *                                   plus `resources/list_changed` (a batch
 *                                   finished; the node set may have changed).
 *   - `node.activity`/`agent.spawn` → `resources/updated` for
 *                                     `skillmap://activity`.
 *
 * Everything else is ignored. ZERO changes to the event producers: the
 * sink is a read-only observer of the same fan-out the UI consumes.
 *
 * Sink lifecycle discipline (why the fields are what they are):
 *   - `readyState` stays OPEN and `bufferedAmount` stays 0 so the
 *     broadcaster never evicts the sink (its `#deliver` drops clients
 *     that are not OPEN or that exceed the backpressure threshold).
 *   - `send` never throws (a parse failure is swallowed): a broadcaster
 *     `send` throw would close + unregister the client.
 *   - `close` is a no-op: the sink owns no socket. It is unregistered
 *     explicitly on server shutdown (see `integration.ts`).
 */

import type { IBroadcasterClient } from '../broadcaster.js';
import { ACTIVITY_RESOURCE_URI, GRAPH_RESOURCE_URI, ISSUES_RESOURCE_URI } from './context.js';
import type { McpSessionManager } from './session-manager.js';

/** `WebSocket.OPEN`, so the broadcaster keeps the sink registered. */
const READY_STATE_OPEN = 1;

export function createMcpBroadcasterSink(manager: McpSessionManager): IBroadcasterClient {
  return {
    send(data: string): void {
      const type = parseEnvelopeType(data);
      if (type === undefined) return;
      if (type === 'scan.completed') {
        manager.notifyResourceUpdated(GRAPH_RESOURCE_URI);
        manager.notifyResourceUpdated(ISSUES_RESOURCE_URI);
        manager.notifyResourceListChanged();
        return;
      }
      if (type === 'node.activity' || type === 'agent.spawn') {
        manager.notifyResourceUpdated(ACTIVITY_RESOURCE_URI);
      }
    },
    close(): void {
      /* no-op: the sink owns no socket; unregistered explicitly on shutdown */
    },
    bufferedAmount: 0,
    readyState: READY_STATE_OPEN,
  };
}

/** Extract the `type` field from a serialised WS envelope; `undefined` on any failure. */
function parseEnvelopeType(data: string): string | undefined {
  try {
    const parsed = JSON.parse(data) as { type?: unknown };
    return typeof parsed.type === 'string' ? parsed.type : undefined;
  } catch {
    return undefined;
  }
}
