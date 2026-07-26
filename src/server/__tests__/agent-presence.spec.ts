/**
 * `AgentPresenceTracker` unit tests + its composition-root wiring through
 * `WsBroadcaster`. Pure (no DB, no server boot).
 *
 * The contract under test (`spec/cli-contract.md` §Serve route table, the
 * `GET /api/agent/presence` row):
 *   - not attending at boot;
 *   - a `job.claimed` envelope flips `attending` and stamps `lastClaimAt`;
 *   - any other envelope is ignored (including malformed ones: the CLI
 *     push leg rebroadcasts a client-supplied body verbatim);
 *   - STICKY, a second claim refreshes `lastClaimAt` but `attending`
 *     never flips back;
 *   - an envelope broadcast through `WsBroadcaster` reaches the tracker,
 *     which is what makes a CLI-pushed claim and an in-process MCP claim
 *     count identically.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { AgentPresenceTracker } from '../agent-presence.js';
import { WsBroadcaster, type IBroadcasterClient } from '../broadcaster.js';

/** A canonical `job.claimed` envelope (`spec/job-events.md` §`job.claimed`). */
function claimEnvelope(jobId = 'd-20260725-101010-0001'): Record<string, unknown> {
  return {
    type: 'job.claimed',
    timestamp: Date.now(),
    runId: 'r-ext-20260725-101010-abcd',
    jobId,
    data: { extensionId: 'core/ai-ping-action', nodeId: 'playground.md' },
  };
}

describe('AgentPresenceTracker', () => {
  it('starts not attending, with no claim timestamp', () => {
    const tracker = new AgentPresenceTracker();
    assert.deepEqual(tracker.snapshot(), { attending: false, lastClaimAt: null });
  });

  it('flips attending and stamps lastClaimAt on a job.claimed envelope', () => {
    const tracker = new AgentPresenceTracker();
    const before = Date.now();
    tracker.observe(claimEnvelope());
    const snapshot = tracker.snapshot();
    assert.equal(snapshot.attending, true);
    assert.ok(snapshot.lastClaimAt !== null && snapshot.lastClaimAt >= before);
  });

  it('ignores every non-claim envelope', () => {
    const tracker = new AgentPresenceTracker();
    tracker.observe({ type: 'job.submitted', jobId: 'd-1', data: {} });
    tracker.observe({ type: 'job.completed', jobId: 'd-1', data: {} });
    tracker.observe({ type: 'scan.completed', data: {} });
    tracker.observe({ type: 'node.activity', data: {} });
    assert.deepEqual(tracker.snapshot(), { attending: false, lastClaimAt: null });
  });

  it('narrows defensively: a malformed envelope is not a claim', () => {
    const tracker = new AgentPresenceTracker();
    tracker.observe(null);
    tracker.observe(undefined);
    tracker.observe('job.claimed');
    tracker.observe(42);
    tracker.observe([{ type: 'job.claimed' }]);
    tracker.observe({});
    assert.equal(tracker.snapshot().attending, false);
  });

  it('is STICKY: a later claim refreshes lastClaimAt, attending stays true', async () => {
    const tracker = new AgentPresenceTracker();
    tracker.observe(claimEnvelope('d-1'));
    const first = tracker.snapshot();
    // One real millisecond so the second stamp is strictly newer.
    await new Promise((resolve) => setTimeout(resolve, 2));
    tracker.observe(claimEnvelope('d-2'));
    const second = tracker.snapshot();
    assert.equal(second.attending, true);
    assert.ok(second.lastClaimAt !== null && first.lastClaimAt !== null);
    assert.ok(second.lastClaimAt > first.lastClaimAt);
  });
});

describe('WsBroadcaster -> AgentPresenceTracker wiring', () => {
  it('a claim ATTEMPT flips attending without stamping lastClaimAt', () => {
    const tracker = new AgentPresenceTracker();
    // The parked `claim_job { wait }` on an empty queue: the agent asks
    // for work, wins nothing, and is attending all the same.
    tracker.noteAttempt();
    const snap = tracker.snapshot();
    assert.equal(snap.attending, true);
    assert.equal(snap.lastClaimAt, null, 'attempts never forge a claim timestamp');
  });

  it('observes an envelope broadcast through the choke point', () => {
    const tracker = new AgentPresenceTracker();
    const broadcaster = new WsBroadcaster({
      onEnvelope: (envelope) => {
        tracker.observe(envelope);
      },
    });
    // No client registered on purpose: a CLI-parked agent claiming a job
    // with no browser open must still be observed.
    assert.equal(broadcaster.clientCount, 0);
    broadcaster.broadcast(claimEnvelope());
    assert.equal(tracker.snapshot().attending, true);
  });

  it('still fans the envelope out to connected clients', () => {
    const tracker = new AgentPresenceTracker();
    const sent: string[] = [];
    const client: IBroadcasterClient = {
      send: (data) => sent.push(data),
      close: () => undefined,
      bufferedAmount: 0,
      readyState: 1,
    };
    const broadcaster = new WsBroadcaster({
      onEnvelope: (envelope) => {
        tracker.observe(envelope);
      },
    });
    broadcaster.register(client);
    broadcaster.broadcast(claimEnvelope('d-3'));
    assert.equal(sent.length, 1);
    assert.ok(sent[0]?.includes('job.claimed'));
    assert.equal(tracker.snapshot().attending, true);
  });

  it('a throwing observer cannot break the fan-out', () => {
    const sent: string[] = [];
    const client: IBroadcasterClient = {
      send: (data) => sent.push(data),
      close: () => undefined,
      bufferedAmount: 0,
      readyState: 1,
    };
    const broadcaster = new WsBroadcaster({
      onEnvelope: () => {
        throw new Error('synthetic observer failure');
      },
    });
    broadcaster.register(client);
    broadcaster.broadcast(claimEnvelope());
    assert.equal(sent.length, 1);
  });

  it('observes nothing after shutdown (the transport is closed)', () => {
    const tracker = new AgentPresenceTracker();
    const broadcaster = new WsBroadcaster({
      onEnvelope: (envelope) => {
        tracker.observe(envelope);
      },
    });
    broadcaster.shutdown();
    broadcaster.broadcast(claimEnvelope());
    assert.equal(tracker.snapshot().attending, false);
  });
});
