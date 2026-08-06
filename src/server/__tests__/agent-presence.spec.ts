/**
 * `AgentPresenceTracker` unit tests + its composition-root wiring through
 * `WsBroadcaster`. Pure (no DB, no server boot).
 *
 * The contract under test (`spec/cli-contract.md` §Serve route table, the
 * `GET /api/agent/presence` row):
 *   - not attending at boot;
 *   - an ANSWER (`job.completed` / `job.failed`) flips `attending`; a
 *     `job.claimed` does NOT (it is a receipt, not an answer) though it
 *     still stamps `lastClaimAt` for display;
 *   - any other envelope is ignored (including malformed ones: the CLI
 *     push leg rebroadcasts a client-supplied body verbatim);
 *   - STICKY, `attending` never flips back on silence;
 *   - an envelope broadcast through `WsBroadcaster` reaches the tracker,
 *     which is what makes a CLI-pushed frame and an in-process MCP one
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

/** The ANSWER: what an agent emits through `sm record` when it comes back. */
function answerEnvelope(jobId = 'd-20260725-101010-0001'): Record<string, unknown> {
  return {
    type: 'job.completed',
    timestamp: Date.now(),
    runId: 'r-ext-20260725-101010-abcd',
    jobId,
    data: { extensionId: 'core/ai-ping-action' },
  };
}

describe('AgentPresenceTracker', () => {
  it('starts not attending, with no claim timestamp', () => {
    const tracker = new AgentPresenceTracker();
    assert.deepEqual(tracker.snapshot(), { attending: false, lastClaimAt: null });
  });

  it('flips attending on an ANSWER envelope', () => {
    const tracker = new AgentPresenceTracker();
    tracker.observe(answerEnvelope());
    assert.equal(tracker.snapshot().attending, true);
    // A `failed` still required running the job, so it counts too.
    const other = new AgentPresenceTracker();
    other.observe({ type: 'job.failed', jobId: 'd-2', data: {} });
    assert.equal(other.snapshot().attending, true);
  });

  /**
   * The regression that made the row lie: an agent parked on
   * `sm jobs claim --wait` claims within one poll cycle, so counting the
   * claim reported "an agent is answering" before the model had read a
   * line of the prompt (and, through the boot ping, before the operator
   * asked anything at all).
   */
  it('does NOT flip attending on a claim, but still stamps lastClaimAt', () => {
    const tracker = new AgentPresenceTracker();
    const before = Date.now();
    tracker.observe(claimEnvelope());
    const snapshot = tracker.snapshot();
    assert.equal(snapshot.attending, false, 'a receipt is not an answer');
    assert.ok(snapshot.lastClaimAt !== null && snapshot.lastClaimAt >= before);
  });

  it('ignores every envelope that is neither an answer nor a claim', () => {
    const tracker = new AgentPresenceTracker();
    tracker.observe({ type: 'job.submitted', jobId: 'd-1', data: {} });
    tracker.observe({ type: 'scan.completed', data: {} });
    tracker.observe({ type: 'node.activity', data: {} });
    assert.deepEqual(tracker.snapshot(), { attending: false, lastClaimAt: null });
  });

  it('narrows defensively: a malformed envelope is not an answer', () => {
    const tracker = new AgentPresenceTracker();
    tracker.observe(null);
    tracker.observe(undefined);
    tracker.observe('job.completed');
    tracker.observe(42);
    tracker.observe([{ type: 'job.completed' }]);
    tracker.observe({});
    assert.equal(tracker.snapshot().attending, false);
  });

  it('is STICKY: a later claim refreshes lastClaimAt, attending stays true', async () => {
    const tracker = new AgentPresenceTracker();
    tracker.observe(answerEnvelope('d-1'));
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
  it('a ping cancelled UNCLAIMED flips attending false; a later answer flips it back', () => {
    const tracker = new AgentPresenceTracker();
    tracker.observe(answerEnvelope('d-0'));
    assert.equal(tracker.snapshot().attending, true);

    // The manual Check Agent probe: ping submitted, nobody claims, the
    // UI cancels it on timeout. That is negative evidence with
    // AUTHORITY: attending flips back to false.
    tracker.observe({
      type: 'job.submitted',
      jobId: 'd-ping-1',
      data: { extensionId: 'core/ai-ping-action' },
    });
    tracker.observe({ type: 'job.cancelled', jobId: 'd-ping-1' });
    assert.equal(tracker.snapshot().attending, false);

    // A mere claim after the negative verdict changes nothing: the next
    // ANSWER is what re-flips it. (The MCP claim-attempt hook that used
    // to re-flip here was removed with the answers-only regime: an agent
    // announcing itself has still answered nothing.)
    tracker.observe(claimEnvelope('d-later'));
    assert.equal(tracker.snapshot().attending, false);
    tracker.observe(answerEnvelope('d-later'));
    assert.equal(tracker.snapshot().attending, true);
  });

  it('a cancel of a CLAIMED ping (or any other job) is not negative evidence', () => {
    const tracker = new AgentPresenceTracker();
    tracker.observe({
      type: 'job.submitted',
      jobId: 'd-ping-2',
      data: { extensionId: 'core/ai-ping-action' },
    });
    tracker.observe({ type: 'job.claimed', jobId: 'd-ping-2' });
    tracker.observe(answerEnvelope('d-ping-2'));
    // A claimed ping later cancelled says nothing about absence.
    tracker.observe({ type: 'job.cancelled', jobId: 'd-ping-2' });
    assert.equal(tracker.snapshot().attending, true);
    // Cancels of ordinary jobs never count either.
    tracker.observe({ type: 'job.submitted', jobId: 'd-normal', data: { extensionId: 'core/ai-summary-action' } });
    tracker.observe({ type: 'job.cancelled', jobId: 'd-normal' });
    assert.equal(tracker.snapshot().attending, true);
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
    broadcaster.broadcast(answerEnvelope());
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
    broadcaster.broadcast(answerEnvelope('d-3'));
    assert.equal(sent.length, 1);
    assert.ok(sent[0]?.includes('job.completed'));
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
    broadcaster.broadcast(answerEnvelope());
    assert.equal(tracker.snapshot().attending, false);
  });
});
