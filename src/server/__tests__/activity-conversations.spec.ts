/**
 * `ActivityConversationStore` unit tests, pure (no DB, no server
 * boot). Gate, retention bounds and copy discipline are normative in
 * `spec/provider-activity.md` §Conversation capture.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ActivityConversationStore,
  CONTENT_CAP_BYTES,
  CONVERSATION_RING_CAP,
  TRUNCATION_MARKER,
} from '../activity-conversations.js';
import type { IResolvedSpawn } from '../activity-resolver.js';

function startFrame(spawnId: string, extra: Partial<IResolvedSpawn> = {}): IResolvedSpawn {
  return {
    spawnId,
    phase: 'start',
    parentOwner: 'a1b2',
    parentNodePath: '.claude/agents/orchestrator.md',
    childKind: 'agent',
    childName: 'worker',
    prompt: 'do the work',
    ...extra,
  };
}

describe('ActivityConversationStore gate', () => {
  it('record() is a no-op while the gate is off', () => {
    const store = new ActivityConversationStore({ enabled: false });
    store.record(startFrame('t1'));
    assert.equal(store.bySpawnId('t1'), null);
    assert.deepEqual(store.byNode('.claude/agents/orchestrator.md'), []);
  });

  it('records while on; turning the gate off clears immediately', () => {
    const store = new ActivityConversationStore({ enabled: true });
    store.record(startFrame('t1'));
    assert.equal(store.bySpawnId('t1')?.prompt, 'do the work');
    store.setEnabled(false);
    assert.equal(store.enabled, false);
    assert.equal(store.bySpawnId('t1'), null);
    // And stays a no-op afterwards.
    store.record(startFrame('t2'));
    assert.equal(store.bySpawnId('t2'), null);
  });
});

describe('ActivityConversationStore upsert', () => {
  it('merges start -> handoff -> end frames under one spawnId', () => {
    const store = new ActivityConversationStore({ enabled: true });
    store.record(startFrame('t1'));
    store.record({
      spawnId: 't1',
      phase: 'handoff',
      parentOwner: 'a1b2',
      parentNodePath: '.claude/agents/orchestrator.md',
      childKind: 'agent',
      childName: 'worker',
      childNodePath: '.claude/agents/worker.md',
      childOwner: 'c9',
    });
    const running = store.bySpawnId('t1');
    assert.equal(running?.status, 'running');
    assert.equal(running?.childOwner, 'c9');
    assert.equal(running?.childNodePath, '.claude/agents/worker.md');
    assert.equal(running?.prompt, 'do the work');
    assert.equal(running?.endedAt, undefined);

    store.record({
      spawnId: 't1',
      phase: 'end',
      parentOwner: 'a1b2',
      parentNodePath: '.claude/agents/orchestrator.md',
      response: 'all done',
    });
    const completed = store.bySpawnId('t1');
    assert.equal(completed?.status, 'completed');
    assert.equal(completed?.response, 'all done');
    assert.equal(completed?.prompt, 'do the work');
    assert.ok(typeof completed?.endedAt === 'number');
  });

  it('a frame with no prior record (gate flipped on mid-flight) still creates one', () => {
    const store = new ActivityConversationStore({ enabled: true });
    store.record({ spawnId: 't1', phase: 'end', parentOwner: 'a1b2', response: 'late' });
    const record = store.bySpawnId('t1');
    assert.equal(record?.status, 'completed');
    assert.equal(record?.response, 'late');
  });

  it('byNode matches on the parent OR the child path', () => {
    const store = new ActivityConversationStore({ enabled: true });
    store.record(startFrame('t1', { childNodePath: '.claude/agents/worker.md' }));
    assert.equal(store.byNode('.claude/agents/orchestrator.md').length, 1);
    assert.equal(store.byNode('.claude/agents/worker.md').length, 1);
    assert.equal(store.byNode('.claude/agents/unrelated.md').length, 0);
  });
});

describe('ActivityConversationStore bounds', () => {
  it('evicts oldest past the ring cap', () => {
    const store = new ActivityConversationStore({ enabled: true });
    for (let i = 0; i < CONVERSATION_RING_CAP + 5; i += 1) {
      store.record(startFrame(`t${i}`));
    }
    assert.equal(store.bySpawnId('t0'), null);
    assert.equal(store.bySpawnId('t4'), null);
    assert.notEqual(store.bySpawnId('t5'), null);
    assert.notEqual(store.bySpawnId(`t${CONVERSATION_RING_CAP + 4}`), null);
  });

  it('caps each content field with the explicit truncation marker', () => {
    const store = new ActivityConversationStore({ enabled: true });
    const huge = 'x'.repeat(CONTENT_CAP_BYTES + 5000);
    store.record(startFrame('t1', { prompt: huge }));
    const prompt = store.bySpawnId('t1')?.prompt;
    assert.ok(prompt!.endsWith(TRUNCATION_MARKER));
    assert.ok(Buffer.byteLength(prompt!, 'utf8') <= CONTENT_CAP_BYTES + TRUNCATION_MARKER.length);
    // Short content passes through verbatim.
    store.record({ spawnId: 't1', phase: 'end', parentOwner: 'a1b2', response: 'short' });
    assert.equal(store.bySpawnId('t1')?.response, 'short');
  });
});

describe('ActivityConversationStore attachReport', () => {
  it('attaches by childOwner match with overwrite semantics (pause then terminal)', () => {
    const store = new ActivityConversationStore({ enabled: true });
    store.record(startFrame('t1'));
    store.record({ spawnId: 't1', phase: 'handoff', parentOwner: 'a1b2', childOwner: 'kid-1' });
    // Pause stop: message so far.
    store.attachReport('kid-1', 'partial message');
    assert.equal(store.bySpawnId('t1')?.response, 'partial message');
    // Terminal stop overwrites: the last writer wins.
    store.attachReport('kid-1', 'final report');
    const record = store.bySpawnId('t1')!;
    assert.equal(record.response, 'final report');
    assert.equal(record.status, 'completed');
    assert.ok(record.endedAt !== undefined);
    // A non-matching owner touches nothing.
    store.attachReport('kid-2', 'someone else');
    assert.equal(store.bySpawnId('t1')?.response, 'final report');
  });

  it('is a no-op while the gate is off', () => {
    const store = new ActivityConversationStore({ enabled: true });
    store.record(startFrame('t1'));
    store.record({ spawnId: 't1', phase: 'handoff', parentOwner: 'a1b2', childOwner: 'kid-1' });
    store.setEnabled(false);
    store.attachReport('kid-1', 'late report');
    assert.equal(store.bySpawnId('t1'), null); // cleared on disable, nothing revived
  });

  it('caps an oversized report like any content field', () => {
    const store = new ActivityConversationStore({ enabled: true });
    store.record(startFrame('t1'));
    store.record({ spawnId: 't1', phase: 'handoff', parentOwner: 'a1b2', childOwner: 'kid-1' });
    store.attachReport('kid-1', 'x'.repeat(CONTENT_CAP_BYTES + 512));
    const response = store.bySpawnId('t1')?.response;
    assert.ok(response!.endsWith(TRUNCATION_MARKER));
    assert.ok(Buffer.byteLength(response!, 'utf8') <= CONTENT_CAP_BYTES + TRUNCATION_MARKER.length);
  });
});

describe('ActivityConversationStore copy discipline', () => {
  it('bySpawnId and byNode hand out copies', () => {
    const store = new ActivityConversationStore({ enabled: true });
    store.record(startFrame('t1'));
    const copy = store.bySpawnId('t1');
    copy!.prompt = 'tampered';
    assert.equal(store.bySpawnId('t1')?.prompt, 'do the work');
    const listed = store.byNode('.claude/agents/orchestrator.md');
    listed[0]!.parentOwner = 'tampered';
    assert.equal(store.byNode('.claude/agents/orchestrator.md')[0]?.parentOwner, 'a1b2');
  });
});
