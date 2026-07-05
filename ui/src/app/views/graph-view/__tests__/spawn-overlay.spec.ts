import { describe, expect, it } from 'vitest';

import type { ISessionView, ISpawnView } from '../../../../services/agent-spawn';
import { NODE_WIDTH, type IPoint } from '../graph-layout';
import {
  edgePairKey,
  resolveSpawnOverlay,
  SESSION_NODE_GAP,
  SESSION_NODE_HEIGHT,
  SESSION_NODE_WIDTH,
  type IResolveSpawnOverlayArgs,
} from '../spawn-overlay';

/**
 * Pure projection tests for `resolveSpawnOverlay`: visibility drops,
 * session survival rules, anchor position math, connector-id shapes,
 * and the self-spawn drop.
 */

const PARENT = '.claude/agents/demo-orchestrator.md';
const CHILD_A = '.claude/agents/demo-worker.md';
const CHILD_B = '.claude/agents/demo-reviewer.md';
const SESSION = 'main:6cfe5636';

function spawn(overrides: Partial<ISpawnView> & { spawnId: string }): ISpawnView {
  return { parentOwner: 'orch-1', ...overrides };
}

function args(
  spawns: ISpawnView[],
  positions: Record<string, IPoint>,
  sessions: ISessionView[] = [{ owner: SESSION, ordinal: 1 }],
  staticPairs: ReadonlySet<string> = new Set(),
): IResolveSpawnOverlayArgs {
  return {
    spawns,
    sessions,
    visiblePaths: new Set(Object.keys(positions)),
    staticPairs,
    positionOf: (path) => positions[path],
  };
}

describe('resolveSpawnOverlay', () => {
  it('projects a node-parent spawn into an edge reusing the cards own connector ids', () => {
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 't1', parentNodePath: PARENT, childNodePath: CHILD_A })],
        { [PARENT]: { x: 0, y: 0 }, [CHILD_A]: { x: 300, y: 200 } },
      ),
    );
    expect(overlay.edges).toEqual([
      { spawnId: 't1', outputId: `${PARENT}-out`, inputId: `${CHILD_A}-in`, fromSession: false },
    ]);
    expect(overlay.sessions.length).toBe(0);
  });

  it('drops edges whose endpoints are hidden or unpositioned, and unresolved children', () => {
    const spawns = [
      // Child hidden by filters.
      spawn({ spawnId: 'hiddenChild', parentNodePath: PARENT, childNodePath: CHILD_B }),
      // Parent hidden.
      spawn({ spawnId: 'hiddenParent', parentNodePath: '.claude/agents/gone.md', childNodePath: CHILD_A }),
      // Unresolved child: name only, nothing to target.
      spawn({ spawnId: 'unresolved', parentNodePath: PARENT, childName: 'phantom' }),
    ];
    const overlay = resolveSpawnOverlay(
      args(spawns, { [PARENT]: { x: 0, y: 0 }, [CHILD_A]: { x: 300, y: 200 } }),
    );
    expect(overlay.edges.length).toBe(0);
  });

  it('drops a self-spawn (parent node == child node)', () => {
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 'self', parentNodePath: PARENT, childNodePath: PARENT })],
        { [PARENT]: { x: 0, y: 0 } },
      ),
    );
    expect(overlay.edges.length).toBe(0);
  });

  it('session parents anchor on session:<owner>-out and float above the children centroid', () => {
    const positions: Record<string, IPoint> = {
      [CHILD_A]: { x: 100, y: 400 },
      [CHILD_B]: { x: 500, y: 600 },
    };
    const overlay = resolveSpawnOverlay(
      args(
        [
          spawn({ spawnId: 's1', parentOwner: SESSION, parentSession: SESSION, childNodePath: CHILD_A }),
          spawn({ spawnId: 's2', parentOwner: SESSION, parentSession: SESSION, childNodePath: CHILD_B }),
        ],
        positions,
      ),
    );
    expect(overlay.edges).toEqual([
      { spawnId: 's1', outputId: `session:${SESSION}-out`, inputId: `${CHILD_A}-in`, fromSession: true },
      { spawnId: 's2', outputId: `session:${SESSION}-out`, inputId: `${CHILD_B}-in`, fromSession: true },
    ]);

    expect(overlay.sessions.length).toBe(1);
    const anchor = overlay.sessions[0]!;
    expect(anchor.id).toBe(`session:${SESSION}`);
    expect(anchor.ordinal).toBe(1);
    // Centroid over card centers: ((100 + 500) / 2) + NODE_WIDTH / 2,
    // recentred on the capsule width; floated a fixed gap above the
    // highest child (y = 400).
    const expectedCenterX = (100 + NODE_WIDTH / 2 + (500 + NODE_WIDTH / 2)) / 2;
    expect(anchor.position.x).toBeCloseTo(expectedCenterX - SESSION_NODE_WIDTH / 2);
    expect(anchor.position.y).toBe(400 - SESSION_NODE_GAP - SESSION_NODE_HEIGHT);
  });

  it('a session survives only while at least one of its edges survives', () => {
    // The only child is NOT visible: no edge, so no anchor either,
    // even though the session itself is live in the service.
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 's3', parentOwner: SESSION, parentSession: SESSION, childNodePath: CHILD_A })],
        { [PARENT]: { x: 0, y: 0 } },
      ),
    );
    expect(overlay.edges.length).toBe(0);
    expect(overlay.sessions.length).toBe(0);
  });

  it('a visible child without a position yet (layout pending) draws nothing', () => {
    const overlay = resolveSpawnOverlay({
      spawns: [spawn({ spawnId: 's4', parentNodePath: PARENT, childNodePath: CHILD_A })],
      sessions: [],
      visiblePaths: new Set([PARENT, CHILD_A]),
      staticPairs: new Set(),
      positionOf: (path) => (path === PARENT ? { x: 0, y: 0 } : undefined),
    });
    expect(overlay.edges.length).toBe(0);
  });

  it('a user-dragged session position wins over the derived centroid float', () => {
    const dragged: IPoint = { x: 42, y: -300 };
    const overlay = resolveSpawnOverlay({
      ...args(
        [spawn({ spawnId: 's5', parentOwner: SESSION, parentSession: SESSION, childNodePath: CHILD_A })],
        { [CHILD_A]: { x: 100, y: 400 } },
      ),
      sessionPositionOf: (owner) => (owner === SESSION ? dragged : undefined),
    });
    expect(overlay.sessions.length).toBe(1);
    expect(overlay.sessions[0]!.position).toEqual(dragged);
  });

  it('without an override for that owner the centroid float still applies', () => {
    const overlay = resolveSpawnOverlay({
      ...args(
        [spawn({ spawnId: 's6', parentOwner: SESSION, parentSession: SESSION, childNodePath: CHILD_A })],
        { [CHILD_A]: { x: 100, y: 400 } },
      ),
      sessionPositionOf: () => undefined,
    });
    expect(overlay.sessions[0]!.position.y).toBe(400 - SESSION_NODE_GAP - SESSION_NODE_HEIGHT);
  });
});

describe('resolveSpawnOverlay, spawn-over-static suppression', () => {
  const POSITIONS: Record<string, IPoint> = {
    [PARENT]: { x: 0, y: 0 },
    [CHILD_A]: { x: 300, y: 200 },
  };

  it('a same-direction rendered static pair suppresses the standalone edge into activeOnStatic', () => {
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 't1', parentNodePath: PARENT, childNodePath: CHILD_A })],
        POSITIONS,
        [],
        new Set([edgePairKey(PARENT, CHILD_A)]),
      ),
    );
    expect(overlay.edges.length).toBe(0);
    expect(overlay.activeOnStatic).toEqual([
      { pairKey: edgePairKey(PARENT, CHILD_A), spawnId: 't1' },
    ]);
  });

  it('a reverse-direction static pair does NOT suppress (arrowhead would point the wrong way)', () => {
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 't2', parentNodePath: PARENT, childNodePath: CHILD_A })],
        POSITIONS,
        [],
        new Set([edgePairKey(CHILD_A, PARENT)]),
      ),
    );
    expect(overlay.edges.map((e) => e.spawnId)).toEqual(['t2']);
    expect(overlay.activeOnStatic.length).toBe(0);
  });

  it('an absent pair (link kind filtered out) keeps the standalone dashed edge', () => {
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 't3', parentNodePath: PARENT, childNodePath: CHILD_A })],
        POSITIONS,
        [],
        new Set([edgePairKey(PARENT, CHILD_B)]),
      ),
    );
    expect(overlay.edges.map((e) => e.spawnId)).toEqual(['t3']);
    expect(overlay.activeOnStatic.length).toBe(0);
  });

  it('session-parent edges never suppress, and the anchor bookkeeping stays intact', () => {
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 't4', parentOwner: SESSION, parentSession: SESSION, childNodePath: CHILD_A })],
        { [CHILD_A]: { x: 100, y: 400 } },
        [{ owner: SESSION, ordinal: 1 }],
        // Even a set covering every imaginable pair leaves session
        // parents alone: a session anchor has no static edge to ride.
        new Set([
          edgePairKey(PARENT, CHILD_A),
          edgePairKey(`session:${SESSION}`, CHILD_A),
          edgePairKey(SESSION, CHILD_A),
        ]),
      ),
    );
    expect(overlay.edges).toEqual([
      { spawnId: 't4', outputId: `session:${SESSION}-out`, inputId: `${CHILD_A}-in`, fromSession: true },
    ]);
    expect(overlay.activeOnStatic.length).toBe(0);
    expect(overlay.sessions.length).toBe(1);
  });
});
