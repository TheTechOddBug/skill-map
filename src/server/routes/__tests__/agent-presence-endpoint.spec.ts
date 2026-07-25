/**
 * `GET /api/agent/presence` unit tests (`spec/cli-contract.md` §Serve
 * route table).
 *
 * The route is a thin read over the boot-scoped `AgentPresenceTracker`,
 * so a mounted Hono app with a real tracker exercises the whole contract
 * without a server boot:
 *   - before any observed claim -> attending: false, lastClaimAt: null
 *   - after one                  -> attending: true,  lastClaimAt: <ms>
 *   - stickiness is the tracker's, the route only projects it.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { Hono } from 'hono';

import { AgentPresenceTracker } from '../../agent-presence.js';
import { registerAgentPresenceRoute } from '../agent-presence.js';

function mount(presence: AgentPresenceTracker): Hono {
  const app = new Hono();
  registerAgentPresenceRoute(app, { presence });
  return app;
}

async function readPresence(app: Hono): Promise<Record<string, unknown>> {
  const res = await app.request('/api/agent/presence');
  assert.equal(res.status, 200);
  return (await res.json()) as Record<string, unknown>;
}

/** A canonical `job.claimed` envelope (`spec/job-events.md` §`job.claimed`). */
const CLAIM = {
  type: 'job.claimed',
  timestamp: 1_700_000_000_000,
  runId: 'r-ext-20260725-101010-abcd',
  jobId: 'd-20260725-101010-0001',
  data: { extensionId: 'core/ai-ping-action', nodeId: 'playground.md' },
};

describe('GET /api/agent/presence', () => {
  it('reports not attending before any claim is observed', async () => {
    const body = await readPresence(mount(new AgentPresenceTracker()));
    assert.equal(body['schemaVersion'], '1');
    assert.equal(body['kind'], 'agent-presence');
    assert.equal(body['attending'], false);
    assert.equal(body['lastClaimAt'], null);
  });

  it('reports attending once a claim has been observed', async () => {
    const presence = new AgentPresenceTracker();
    const app = mount(presence);
    presence.observe(CLAIM);
    const body = await readPresence(app);
    assert.equal(body['attending'], true);
    assert.equal(typeof body['lastClaimAt'], 'number');
  });

  it('keeps reporting attending after a non-claim envelope (sticky)', async () => {
    const presence = new AgentPresenceTracker();
    const app = mount(presence);
    presence.observe(CLAIM);
    const first = await readPresence(app);
    presence.observe({ type: 'job.completed', jobId: 'd-1', data: {} });
    const second = await readPresence(app);
    assert.equal(second['attending'], true);
    assert.equal(second['lastClaimAt'], first['lastClaimAt']);
  });
});
