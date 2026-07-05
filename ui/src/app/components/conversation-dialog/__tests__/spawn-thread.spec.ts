import { describe, expect, it } from 'vitest';

import { groupSpawnThreads, threadKeyOf } from '../spawn-thread';
import type { IActivitySpawnRecordApi } from '../../../../models/api';

/**
 * Pure spawn-thread grouping: key composition (childNodePath >
 * childName > spawnId), same-pair merging, ASC turn order inside a
 * thread, DESC thread order across threads, and the singleton shape.
 */

function makeRecord(overrides: Partial<IActivitySpawnRecordApi> = {}): IActivitySpawnRecordApi {
  return {
    spawnId: 'toolu_01',
    parentOwner: 'main:6cfe5636',
    childKind: 'agent',
    childName: 'demo-worker',
    childNodePath: '.claude/agents/demo-worker.md',
    startedAt: 1_700_000_000_000,
    status: 'ended',
    ...overrides,
  };
}

describe('threadKeyOf', () => {
  it('prefers childNodePath as the child identity', () => {
    expect(threadKeyOf(makeRecord())).toBe('main:6cfe5636>>.claude/agents/demo-worker.md');
  });

  it('falls back to childName when childNodePath is absent', () => {
    const record = makeRecord({ childNodePath: undefined });
    expect(threadKeyOf(record)).toBe('main:6cfe5636>>demo-worker');
  });

  it('falls back to spawnId when neither childNodePath nor childName exist', () => {
    const record = makeRecord({ childNodePath: undefined, childName: undefined });
    expect(threadKeyOf(record)).toBe('main:6cfe5636>>toolu_01');
  });
});

describe('groupSpawnThreads', () => {
  it('merges records of the same parentOwner + child into one thread', () => {
    const threads = groupSpawnThreads([
      makeRecord({ spawnId: 's1', startedAt: 1000 }),
      makeRecord({ spawnId: 's2', startedAt: 2000 }),
      makeRecord({ spawnId: 's3', startedAt: 3000 }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.records).toHaveLength(3);
    expect(threads[0]!.parentOwner).toBe('main:6cfe5636');
    expect(threads[0]!.childName).toBe('demo-worker');
    expect(threads[0]!.childNodePath).toBe('.claude/agents/demo-worker.md');
  });

  it('splits records with a different parentOwner into separate threads', () => {
    const threads = groupSpawnThreads([
      makeRecord({ spawnId: 's1', startedAt: 1000 }),
      makeRecord({ spawnId: 's2', startedAt: 2000, parentOwner: 'agent:other' }),
    ]);
    expect(threads).toHaveLength(2);
  });

  it('groups path-less records by childName, and anonymous records never merge', () => {
    const threads = groupSpawnThreads([
      makeRecord({ spawnId: 's1', startedAt: 1000, childNodePath: undefined }),
      makeRecord({ spawnId: 's2', startedAt: 2000, childNodePath: undefined }),
      makeRecord({ spawnId: 's3', startedAt: 3000, childNodePath: undefined, childName: undefined }),
      makeRecord({ spawnId: 's4', startedAt: 4000, childNodePath: undefined, childName: undefined }),
    ]);
    // s1+s2 merge on childName; s3 and s4 each stand alone on spawnId.
    expect(threads).toHaveLength(3);
    const byName = threads.find((t) => t.key.endsWith('>>demo-worker'));
    expect(byName?.records.map((r) => r.spawnId)).toEqual(['s1', 's2']);
  });

  it('sorts the records of a thread ASC by startedAt (turn order)', () => {
    const threads = groupSpawnThreads([
      makeRecord({ spawnId: 's3', startedAt: 3000 }),
      makeRecord({ spawnId: 's1', startedAt: 1000 }),
      makeRecord({ spawnId: 's2', startedAt: 2000 }),
    ]);
    expect(threads[0]!.records.map((r) => r.spawnId)).toEqual(['s1', 's2', 's3']);
  });

  it('sorts threads DESC by their latest startedAt (most recent first)', () => {
    const threads = groupSpawnThreads([
      // Old pair: latest turn at 2000.
      makeRecord({ spawnId: 'a1', startedAt: 500, childNodePath: 'a.md' }),
      makeRecord({ spawnId: 'a2', startedAt: 2000, childNodePath: 'a.md' }),
      // Newer pair: single turn at 3000 (an EARLIER first turn must not
      // demote the thread; only the latest turn ranks it).
      makeRecord({ spawnId: 'b1', startedAt: 3000, childNodePath: 'b.md' }),
    ]);
    expect(threads.map((t) => t.records[0]!.spawnId)).toEqual(['b1', 'a1']);
  });

  it('builds a singleton thread from a single record (graph fallback shape)', () => {
    const record = makeRecord({ prompt: 'do it', response: 'done' });
    const threads = groupSpawnThreads([record]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.key).toBe(threadKeyOf(record));
    expect(threads[0]!.records).toEqual([record]);
    expect(threads[0]!.parentNodePath).toBeUndefined();
  });

  it('lets later turns override the descriptive fields when defined', () => {
    const threads = groupSpawnThreads([
      makeRecord({ spawnId: 's1', startedAt: 1000, childName: undefined }),
      makeRecord({
        spawnId: 's2',
        startedAt: 2000,
        childName: 'demo-worker',
        parentNodePath: '.claude/agents/demo-orchestrator.md',
      }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.childName).toBe('demo-worker');
    expect(threads[0]!.parentNodePath).toBe('.claude/agents/demo-orchestrator.md');
  });

  it('returns an empty list for no records', () => {
    expect(groupSpawnThreads([])).toEqual([]);
  });
});
