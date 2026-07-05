import { describe, expect, it } from 'vitest';

import { isAgentSpawnEvent, isNodeActivityEvent } from '../ws-event';

/**
 * Guard coverage for the live-activity v1.1 wire additions
 * (`spec/provider-activity.md`): the `agent.spawn` family and the
 * `keepAlive` / `stats` fields on `node.activity`. The baseline
 * `isNodeActivityEvent` matrix lives in `node-activity.spec.ts`; this
 * file owns only the new surfaces.
 */

const CHILD = '.claude/agents/demo-worker.md';
const PARENT = '.claude/agents/demo-orchestrator.md';

/** Loose payload bag: the guard is exactly what turns this into the typed shape. */
function spawnEvent(data: Record<string, unknown>): unknown {
  return { type: 'agent.spawn', timestamp: 1_700_000_000_000, data };
}

describe('isAgentSpawnEvent', () => {
  it('accepts a start frame with a node parent', () => {
    expect(
      isAgentSpawnEvent(
        spawnEvent({
          spawnId: 'toolu_01',
          phase: 'start',
          parentOwner: 'orch-1',
          parentNodePath: PARENT,
          childKind: 'agent',
          childName: 'demo-worker',
          childNodePath: CHILD,
        }),
      ),
    ).toBe(true);
  });

  it('accepts a session-parent start (parentNodePath ABSENT, parentOwner present)', () => {
    expect(
      isAgentSpawnEvent(
        spawnEvent({
          spawnId: 'toolu_02',
          phase: 'start',
          parentOwner: 'main:6cfe5636',
          childName: 'demo-worker',
        }),
      ),
    ).toBe(true);
  });

  it('accepts handoff (childOwner present) and end frames', () => {
    expect(
      isAgentSpawnEvent(
        spawnEvent({
          spawnId: 'toolu_03',
          phase: 'handoff',
          parentOwner: 'orch-1',
          parentNodePath: PARENT,
          childOwner: 'worker-1',
        }),
      ),
    ).toBe(true);
    expect(
      isAgentSpawnEvent(
        spawnEvent({ spawnId: 'toolu_03', phase: 'end', parentOwner: 'orch-1' }),
      ),
    ).toBe(true);
  });

  it('accepts an unresolved child (childName only, no childNodePath)', () => {
    expect(
      isAgentSpawnEvent(
        spawnEvent({
          spawnId: 'toolu_04',
          phase: 'start',
          parentOwner: 'main:abc',
          childName: 'not-a-scanned-agent',
        }),
      ),
    ).toBe(true);
  });

  it('rejects a missing / empty spawnId', () => {
    expect(
      isAgentSpawnEvent(spawnEvent({ phase: 'start', parentOwner: 'main:abc' })),
    ).toBe(false);
    expect(
      isAgentSpawnEvent(spawnEvent({ spawnId: '', phase: 'start', parentOwner: 'main:abc' })),
    ).toBe(false);
  });

  it('rejects an unknown phase and a missing parentOwner', () => {
    expect(
      isAgentSpawnEvent(
        spawnEvent({ spawnId: 't', phase: 'running', parentOwner: 'main:abc' }),
      ),
    ).toBe(false);
    expect(isAgentSpawnEvent(spawnEvent({ spawnId: 't', phase: 'start' }))).toBe(false);
    expect(
      isAgentSpawnEvent(spawnEvent({ spawnId: 't', phase: 'start', parentOwner: '' })),
    ).toBe(false);
  });

  it('rejects mistyped or empty optionals (parentNodePath absence is the discriminator)', () => {
    expect(
      isAgentSpawnEvent(
        spawnEvent({ spawnId: 't', phase: 'start', parentOwner: 'o', parentNodePath: '' }),
      ),
    ).toBe(false);
    expect(
      isAgentSpawnEvent(
        spawnEvent({ spawnId: 't', phase: 'start', parentOwner: 'o', childOwner: 42 }),
      ),
    ).toBe(false);
    expect(
      isAgentSpawnEvent(
        spawnEvent({ spawnId: 't', phase: 'start', parentOwner: 'o', childName: 7 }),
      ),
    ).toBe(false);
  });

  it('rejects other event types and malformed envelopes', () => {
    expect(
      isAgentSpawnEvent({ type: 'node.activity', timestamp: 1, data: { spawnId: 't' } }),
    ).toBe(false);
    expect(isAgentSpawnEvent({ type: 'agent.spawn', timestamp: 1 })).toBe(false);
    expect(isAgentSpawnEvent(null)).toBe(false);
  });
});

describe('isNodeActivityEvent, v1.1 fields (keepAlive + stats)', () => {
  it('accepts keepAlive starts and stats-bearing frames', () => {
    expect(
      isNodeActivityEvent({
        type: 'node.activity',
        timestamp: 1,
        data: { nodePath: PARENT, phase: 'start', owner: 'child-1', sticky: true, keepAlive: true },
      }),
    ).toBe(true);
    expect(
      isNodeActivityEvent({
        type: 'node.activity',
        timestamp: 1,
        data: {
          nodePath: CHILD,
          phase: 'start',
          owner: 'main:abc',
          stats: { count: 3, lastStartAt: 1_700_000_001_234, distinctOwners: 2 },
        },
      }),
    ).toBe(true);
  });

  it('rejects mistyped keepAlive and stats without a numeric count', () => {
    expect(
      isNodeActivityEvent({
        type: 'node.activity',
        timestamp: 1,
        data: { nodePath: CHILD, phase: 'start', keepAlive: 'yes' },
      }),
    ).toBe(false);
    expect(
      isNodeActivityEvent({
        type: 'node.activity',
        timestamp: 1,
        data: { nodePath: CHILD, phase: 'start', stats: { count: 'many' } },
      }),
    ).toBe(false);
    expect(
      isNodeActivityEvent({
        type: 'node.activity',
        timestamp: 1,
        data: { nodePath: CHILD, phase: 'start', stats: 7 },
      }),
    ).toBe(false);
  });
});
