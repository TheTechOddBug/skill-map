/**
 * `GET /api/agent/presence`, the honest "is a processing agent attending
 * this project's queue?" probe (`spec/cli-contract.md` §Serve route
 * table).
 *
 * Reports two facts, both read straight off the boot-scoped
 * `AgentPresenceTracker`:
 *   - `attending`: an ANSWER (`job.completed` / `job.failed`) has been
 *     OBSERVED since this server started. A `job.claimed` is a receipt,
 *     not an answer, and deliberately does not count (see the tracker's
 *     file header). STICKY on silence (a parked agent answers only when
 *     work arrives, so silence proves nothing and a TTL would manufacture
 *     false negatives); an unanswered ping's cancel flips it back.
 *   - `lastClaimAt`: epoch-ms of the most recent observed claim, display
 *     only ("when was work last picked up"); `null` before the first one.
 *
 * This is the endpoint that replaces the WRONG proxy the inspector used
 * to warn on (the live MCP session count from `GET /api/mcp/status`): an
 * agent parked on `sm jobs claim --wait` holds no MCP session, so a
 * session count reports a healthy setup as disconnected. Both record
 * paths, the CLI push leg and the in-process MCP record, cross
 * `WsBroadcaster.broadcast()`, which is where the tracker observes them.
 *
 * Ephemeral by construction: the state dies with the process, like the
 * live-activity stats. No DB, no config, no `$HOME`.
 */

import type { Hono } from 'hono';

import type { AgentPresenceTracker } from '../agent-presence.js';
import { REST_ENVELOPE_SCHEMA_VERSION } from '../envelope.js';

/** Deliberately NARROW deps: the tracker and nothing else. */
export interface IAgentPresenceRouteDeps {
  presence: AgentPresenceTracker;
}

export function registerAgentPresenceRoute(app: Hono, deps: IAgentPresenceRouteDeps): void {
  app.get('/api/agent/presence', (c) => {
    const { attending, lastClaimAt } = deps.presence.snapshot();
    return c.json({
      schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
      kind: 'agent-presence',
      attending,
      lastClaimAt,
    });
  });
}
