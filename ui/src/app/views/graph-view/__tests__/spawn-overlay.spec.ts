import { describe, expect, it } from 'vitest';

import type { ISessionView, ISpawnView } from '../../../../services/agent-spawn';
import { NODE_WIDTH, type IPoint } from '../graph-layout';
import {
  edgePairKey,
  resolveSpawnOverlay,
  SESSION_NODE_GAP,
  SESSION_NODE_HEIGHT,
  SESSION_NODE_STACK_GAP,
  SESSION_NODE_WIDTH,
  VAGENT_NODE_GAP,
  VAGENT_NODE_HEIGHT,
  VAGENT_NODE_ID_PREFIX,
  VAGENT_NODE_SPREAD,
  VAGENT_NODE_WIDTH,
  type IResolveSpawnOverlayArgs,
} from '../spawn-overlay';
import { NODE_HEIGHT } from '../graph-layout';

/**
 * Pure projection tests for `resolveSpawnOverlay`: visibility drops,
 * session survival rules, anchor position math, connector-id shapes,
 * the self-spawn drop, and the ephemeral agent capsules for
 * unresolved children (aggregation, row layout, session survival,
 * instructions-node affinity).
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
      {
        spawnId: 't1',
        sourceId: PARENT,
        targetId: CHILD_A,
        fromSession: false,
        pairKey: edgePairKey(PARENT, CHILD_A),
      },
    ]);
    expect(overlay.sessions.length).toBe(0);
  });

  it('drops edges whose endpoints are hidden or unpositioned, and nameless unresolved children', () => {
    const spawns = [
      // Child hidden by filters.
      spawn({ spawnId: 'hiddenChild', parentNodePath: PARENT, childNodePath: CHILD_B }),
      // Parent hidden.
      spawn({ spawnId: 'hiddenParent', parentNodePath: '.claude/agents/gone.md', childNodePath: CHILD_A }),
      // Unresolved child WITHOUT a name: nothing to label, no capsule.
      spawn({ spawnId: 'unresolved', parentNodePath: PARENT }),
    ];
    const overlay = resolveSpawnOverlay(
      args(spawns, { [PARENT]: { x: 0, y: 0 }, [CHILD_A]: { x: 300, y: 200 } }),
    );
    expect(overlay.edges.length).toBe(0);
    expect(overlay.agents.length).toBe(0);
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

  it('session parents anchor on the session:<owner> connector and float above the children centroid', () => {
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
    // Session edges key their pair by the raw OWNER (the server
    // accumulator's identity), never the `session:<owner>` node id.
    expect(overlay.edges).toEqual([
      {
        spawnId: 's1',
        sourceId: `session:${SESSION}`,
        targetId: CHILD_A,
        fromSession: true,
        pairKey: edgePairKey(SESSION, CHILD_A),
      },
      {
        spawnId: 's2',
        sourceId: `session:${SESSION}`,
        targetId: CHILD_B,
        fromSession: true,
        pairKey: edgePairKey(SESSION, CHILD_B),
      },
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
      {
        spawnId: 't4',
        sourceId: `session:${SESSION}`,
        targetId: CHILD_A,
        fromSession: true,
        pairKey: edgePairKey(SESSION, CHILD_A),
      },
    ]);
    expect(overlay.activeOnStatic.length).toBe(0);
    expect(overlay.sessions.length).toBe(1);
  });
});

describe('resolveSpawnOverlay, agent capsules (unresolved children)', () => {
  const CAPSULE_EXPLORE = `${VAGENT_NODE_ID_PREFIX}${PARENT}|Explore`;

  it('a named unresolved child becomes a capsule below its parent card, plus a dashed edge', () => {
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 'v1', parentNodePath: PARENT, childName: 'Explore', childKind: 'agent' })],
        { [PARENT]: { x: 100, y: 50 } },
      ),
    );
    expect(overlay.agents).toEqual([
      {
        id: CAPSULE_EXPLORE,
        anchorId: PARENT,
        name: 'Explore',
        kind: 'agent',
        count: 1,
        spawnId: 'v1',
        // Single capsule: centered under the card, a gap below it.
        position: {
          x: 100 + NODE_WIDTH / 2 - VAGENT_NODE_WIDTH / 2,
          y: 50 + NODE_HEIGHT + VAGENT_NODE_GAP,
        },
      },
    ]);
    expect(overlay.edges).toEqual([
      {
        spawnId: 'v1',
        sourceId: PARENT,
        targetId: CAPSULE_EXPLORE,
        fromSession: false,
        pairKey: edgePairKey(PARENT, CAPSULE_EXPLORE),
      },
    ]);
    // Presentation only: never a session, never static-suppressed.
    expect(overlay.sessions.length).toBe(0);
    expect(overlay.activeOnStatic.length).toBe(0);
  });

  it('aggregates same-name spawns into one capsule with a count and the most recent spawnId', () => {
    const overlay = resolveSpawnOverlay(
      args(
        [
          spawn({ spawnId: 'v1', parentNodePath: PARENT, childName: 'Explore' }),
          spawn({ spawnId: 'v2', parentNodePath: PARENT, childName: 'Explore', childKind: 'agent' }),
          spawn({ spawnId: 'v3', parentNodePath: PARENT, childName: 'Explore' }),
        ],
        { [PARENT]: { x: 0, y: 0 } },
      ),
    );
    expect(overlay.agents.length).toBe(1);
    const capsule = overlay.agents[0]!;
    expect(capsule.count).toBe(3);
    expect(capsule.spawnId).toBe('v3'); // emission order, most recent wins
    expect(capsule.kind).toBe('agent'); // first reported kind sticks
    expect(overlay.edges.length).toBe(1); // one dashed edge per capsule, not per spawn
  });

  it('rows distinct names side by side, centered under the anchor', () => {
    const overlay = resolveSpawnOverlay(
      args(
        [
          spawn({ spawnId: 'v1', parentNodePath: PARENT, childName: 'Explore' }),
          spawn({ spawnId: 'v2', parentNodePath: PARENT, childName: 'Plan' }),
        ],
        { [PARENT]: { x: 0, y: 0 } },
      ),
    );
    expect(overlay.agents.map((a) => a.name)).toEqual(['Explore', 'Plan']);
    const total = 2 * VAGENT_NODE_WIDTH + VAGENT_NODE_SPREAD;
    const x0 = NODE_WIDTH / 2 - total / 2;
    expect(overlay.agents[0]!.position.x).toBeCloseTo(x0);
    expect(overlay.agents[1]!.position.x).toBeCloseTo(x0 + VAGENT_NODE_WIDTH + VAGENT_NODE_SPREAD);
    expect(overlay.agents[0]!.position.y).toBe(NODE_HEIGHT + VAGENT_NODE_GAP);
  });

  it('drops the capsule when its parent anchor is hidden', () => {
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 'v1', parentNodePath: '.claude/agents/gone.md', childName: 'Explore' })],
        { [PARENT]: { x: 0, y: 0 } },
      ),
    );
    expect(overlay.agents.length).toBe(0);
    expect(overlay.edges.length).toBe(0);
  });

  it('a session with ONLY capsules still renders its anchor, capsules float above it', () => {
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 'v1', parentOwner: SESSION, parentSession: SESSION, childName: 'Explore' })],
        { [PARENT]: { x: 0, y: 0 } },
      ),
    );
    // Previously this session was invisible (no resolved child, no
    // anchor); the capsule now keeps it alive.
    expect(overlay.sessions.length).toBe(1);
    const anchor = overlay.sessions[0]!;
    // No instructions node: hover above the visible graph's top edge.
    expect(anchor.position.x).toBeCloseTo(NODE_WIDTH / 2 - SESSION_NODE_WIDTH / 2);
    expect(anchor.position.y).toBe(-2 * SESSION_NODE_GAP - SESSION_NODE_HEIGHT);

    expect(overlay.agents.length).toBe(1);
    const capsule = overlay.agents[0]!;
    expect(capsule.id).toBe(`${VAGENT_NODE_ID_PREFIX}session:${SESSION}|Explore`);
    expect(capsule.anchorId).toBe(`session:${SESSION}`);
    // Below the session capsule: the session is guaranteed above
    // content, so everything it runs hangs under it, edges top-down.
    expect(capsule.position.y).toBe(
      anchor.position.y + SESSION_NODE_HEIGHT + SESSION_NODE_STACK_GAP,
    );

    expect(overlay.edges).toEqual([
      {
        spawnId: 'v1',
        sourceId: `session:${SESSION}`,
        targetId: capsule.id,
        fromSession: true,
        // Session capsules key their pair by the raw OWNER, mirroring
        // the resolved-child session rule.
        pairKey: edgePairKey(SESSION, capsule.id),
      },
    ]);
  });

  it('showAgents: false suppresses capsules wholesale (pre-capsule behavior)', () => {
    const overlay = resolveSpawnOverlay({
      ...args(
        [
          spawn({ spawnId: 'v1', parentNodePath: PARENT, childName: 'Explore' }),
          spawn({ spawnId: 'v2', parentOwner: SESSION, parentSession: SESSION, childName: 'Plan' }),
        ],
        { [PARENT]: { x: 0, y: 0 } },
      ),
      showAgents: false,
    });
    expect(overlay.agents.length).toBe(0);
    expect(overlay.edges.length).toBe(0);
    // A session with ONLY unresolved children renders no anchor either.
    expect(overlay.sessions.length).toBe(0);
  });

  it('a capsule row dodges DOWNWARD past real cards sitting below its parent', () => {
    // The reported overlap: in the top-down layout the parent's real
    // children live right below it, exactly where the row's preferred
    // band is. Blocker occupies y 200..320 (+8 clearance), preferred
    // row y is 176; stepping by VAGENT_NODE_HEIGHT + STACK_GAP (48)
    // lands the first clear band at 368.
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 'v1', parentNodePath: PARENT, childName: 'Explore' })],
        { [PARENT]: { x: 0, y: 0 }, [CHILD_A]: { x: 0, y: 200 } },
      ),
    );
    expect(overlay.agents[0]!.position.y).toBe(368);
    // Still centered under the parent: only the axis of the dodge moves.
    expect(overlay.agents[0]!.position.x).toBeCloseTo(NODE_WIDTH / 2 - VAGENT_NODE_WIDTH / 2);
  });

  it('a session anchor dodges UPWARD past a real card occupying its float spot', () => {
    // Session floats above CHILD_A (base y = 400 - 80 - 44 = 276); the
    // blocker at y 250 covers that band, two -56 steps clear it at 164.
    const overlay = resolveSpawnOverlay(
      args(
        [spawn({ spawnId: 's1', parentOwner: SESSION, parentSession: SESSION, childNodePath: CHILD_A })],
        { [CHILD_A]: { x: 100, y: 400 }, [CHILD_B]: { x: 100, y: 250 } },
      ),
    );
    expect(overlay.sessions[0]!.position.y).toBe(164);
  });

  it('a user-dragged capsule position wins over the row layout', () => {
    const dragged: IPoint = { x: -50, y: 900 };
    const overlay = resolveSpawnOverlay({
      ...args(
        [spawn({ spawnId: 'v1', parentNodePath: PARENT, childName: 'Explore' })],
        { [PARENT]: { x: 0, y: 0 } },
      ),
      agentPositionOf: (id) => (id === CAPSULE_EXPLORE ? dragged : undefined),
    });
    expect(overlay.agents[0]!.position).toEqual(dragged);
  });
});

describe('resolveSpawnOverlay, instructions-node affinity', () => {
  const INSTRUCTIONS = 'AGENTS.md';

  it('a session floats above the instructions card, clamped above its spawned child', () => {
    const overlay = resolveSpawnOverlay({
      ...args(
        [spawn({ spawnId: 's1', parentOwner: SESSION, parentSession: SESSION, childNodePath: CHILD_A })],
        { [CHILD_A]: { x: 700, y: 400 }, [INSTRUCTIONS]: { x: 100, y: 500 } },
      ),
      instructionsPath: INSTRUCTIONS,
    });
    expect(overlay.sessions.length).toBe(1);
    // Affinity x (docked over the instructions card), but the y is the
    // CEILING: the child at y=400 outranks the affinity spot (y=376
    // would sit level with the child, the arrow would read sideways).
    expect(overlay.sessions[0]!.position).toEqual({
      x: 100 + NODE_WIDTH / 2 - SESSION_NODE_WIDTH / 2,
      y: 400 - SESSION_NODE_GAP - SESSION_NODE_HEIGHT,
    });
  });

  it('a session never sits below the agent node it spawned (the clamp beats the affinity)', () => {
    const overlay = resolveSpawnOverlay({
      ...args(
        [spawn({ spawnId: 's1', parentOwner: SESSION, parentSession: SESSION, childNodePath: CHILD_A })],
        // The spawned agent sits far ABOVE the instructions card.
        { [CHILD_A]: { x: 700, y: 100 }, [INSTRUCTIONS]: { x: 100, y: 500 } },
      ),
      instructionsPath: INSTRUCTIONS,
    });
    expect(overlay.sessions[0]!.position.y).toBe(100 - SESSION_NODE_GAP - SESSION_NODE_HEIGHT);
  });

  it('parallel sessions stack upward over the instructions card, never overlapping', () => {
    const other = 'main:other';
    const overlay = resolveSpawnOverlay({
      ...args(
        [
          spawn({ spawnId: 's1', parentOwner: SESSION, parentSession: SESSION, childName: 'Plan' }),
          spawn({ spawnId: 's2', parentOwner: other, parentSession: other, childName: 'Explore' }),
        ],
        { [INSTRUCTIONS]: { x: 100, y: 500 } },
        [
          { owner: SESSION, ordinal: 1 },
          { owner: other, ordinal: 2 },
        ],
      ),
      instructionsPath: INSTRUCTIONS,
    });
    expect(overlay.sessions.length).toBe(2);
    const first = overlay.sessions[0]!.position;
    const second = overlay.sessions[1]!.position;
    expect(first.x).toBe(second.x);
    // The second session's occupancy dodge steps it one band above the
    // first (its own capsule row hangs below itself either way).
    expect(first.y - second.y).toBe(SESSION_NODE_HEIGHT + SESSION_NODE_STACK_GAP);
  });

  it('a dragged session still wins over the affinity', () => {
    const dragged: IPoint = { x: 5, y: 5 };
    const overlay = resolveSpawnOverlay({
      ...args(
        [spawn({ spawnId: 's1', parentOwner: SESSION, parentSession: SESSION, childNodePath: CHILD_A })],
        { [CHILD_A]: { x: 700, y: 400 }, [INSTRUCTIONS]: { x: 100, y: 500 } },
      ),
      instructionsPath: INSTRUCTIONS,
      sessionPositionOf: (owner) => (owner === SESSION ? dragged : undefined),
    });
    expect(overlay.sessions[0]!.position).toEqual(dragged);
  });

  it('an instructions path that is not rendered falls back to the centroid float', () => {
    const overlay = resolveSpawnOverlay({
      ...args(
        [spawn({ spawnId: 's1', parentOwner: SESSION, parentSession: SESSION, childNodePath: CHILD_A })],
        { [CHILD_A]: { x: 100, y: 400 } },
      ),
      instructionsPath: INSTRUCTIONS, // hidden by filters: not in visiblePaths
    });
    expect(overlay.sessions[0]!.position.y).toBe(400 - SESSION_NODE_GAP - SESSION_NODE_HEIGHT);
  });
});
