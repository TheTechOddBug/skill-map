/**
 * Pure projection from live spawn state (`AgentSpawnService`) to the
 * graph's ephemeral overlay: dashed spawn edges, floating session
 * anchors, and ephemeral agent capsules for unresolved children.
 *
 * LAYERED BESIDE `graph()` on purpose: nothing here ever reaches
 * `fullLayout`, the reconciler, persisted positions, or the fit bbox.
 * Session and capsule ids are synthetic (`session:<owner>`,
 * `vagent:<anchor>|<name>`), never node paths, so an accidental leak
 * into any path-keyed structure is loudly visible.
 *
 * Visibility rules:
 *   - an edge survives only when BOTH endpoints are on the canvas
 *     (child node visible + positioned; parent node visible +
 *     positioned, or a session anchor);
 *   - a self-spawn (parent node == child node) draws nothing, a loop
 *     edge on one card is visual noise with no information;
 *   - a node-parent spawn whose exact same-direction pair is already a
 *     RENDERED static edge draws no standalone dashed edge either: it
 *     surfaces in `activeOnStatic` and the static edge takes the live
 *     spawn treatment (no duplicated arrows between the same pair);
 *   - a session anchor renders while >= 1 of its edges OR agent
 *     capsules survives. Position: user-dragged override, else beside
 *     the project-instructions node when one is rendered (the visual
 *     affinity of spec §WS event: `agent.spawn`), else above the
 *     centroid of its visible children, else (only capsules, no
 *     instructions node) above the visible graph's top edge. Whatever
 *     placed it, a derived session is CLAMPED above the highest child
 *     it spawned: the session reads top-down, its edges leave from its
 *     underside, so it must never sit below a target;
 *   - an unresolved child WITH a name becomes an agent capsule (spec
 *     §WS event: `agent.spawn`, unresolved children): one capsule per
 *     (anchor, name) aggregating every live spawn of that pair, with a
 *     count. Capsules hang below their anchor (the parent card, or the
 *     session capsule, which is guaranteed to sit above content). A
 *     nameless unresolved child still draws nothing: there is nothing
 *     to label.
 *
 * Connector id contract: node endpoints reuse the SAME unified fConnector
 * connector ids the scan-link edges use (Foblex connections are
 * connector-to-connector and connectors are shared); session anchors
 * and agent capsules own their synthetic ids.
 */

import { activityPairKeyOf } from '../../../models/api';
import type { ISessionView, ISpawnView } from '../../../services/agent-spawn';
import { NODE_HEIGHT, NODE_WIDTH, type IPoint } from './graph-layout';

/** Synthetic node-id prefix for session anchors. */
export const SESSION_NODE_ID_PREFIX = 'session:';

/**
 * Session-anchor footprint + float offset, in canvas units. The
 * capsule is far smaller than a node card; the gap keeps the dashed
 * drop toward the children readable.
 */
export const SESSION_NODE_WIDTH = 170;
export const SESSION_NODE_HEIGHT = 44;
export const SESSION_NODE_GAP = 80;

/**
 * Vertical spacing between parallel session anchors stacked over the
 * SAME spot (instructions-node affinity / no-children fallback), where
 * no per-session centroid separates them.
 */
export const SESSION_NODE_STACK_GAP = 12;

/** Synthetic node-id prefix for ephemeral agent capsules. */
export const VAGENT_NODE_ID_PREFIX = 'vagent:';

/**
 * Agent-capsule footprint + offsets, in canvas units. Sized in the
 * `<sm-agent-capsule>` styles, keep them in sync.
 */
export const VAGENT_NODE_WIDTH = 170;
export const VAGENT_NODE_HEIGHT = 36;
export const VAGENT_NODE_GAP = 56;
/** Horizontal gap between sibling capsules rowed under one anchor. */
export const VAGENT_NODE_SPREAD = 16;

export interface ISpawnOverlayEdge {
  spawnId: string;
  /** Foblex connector ids (plain node paths / `session:<owner>`). */
  sourceId: string;
  targetId: string;
  /** True when the parent anchor is a session node. */
  fromSession: boolean;
  /**
   * Directional pair key matching the server accumulator (spec
   * §Execution stats): parent node path for node parents, session
   * OWNER for session parents (the raw owner key, never the
   * `session:<owner>` node id). Feeds the conversation-count label.
   */
  pairKey: string;
}

/**
 * A spawn whose exact same-direction pair is ALREADY drawn by the scan
 * topology: instead of duplicating it with a parallel dashed edge, the
 * live state rides the static edge (the `.f-conn--spawn-active`
 * treatment + the conversation click).
 */
export interface ISpawnActiveOnStatic {
  /** `edgePairKey(from, to)` of the rendered static edge hosting it. */
  pairKey: string;
  spawnId: string;
}

/**
 * Directional pair key of a rendered static edge (`from>>to`).
 * Delegates to the wire-key helper so the `>>` convention has a single
 * source (the summary's `pairs` record uses the same keys).
 */
export function edgePairKey(from: string, to: string): string {
  return activityPairKeyOf(from, to);
}

export interface ISpawnOverlaySession {
  /** Synthetic Foblex node id (`session:<owner>`). */
  id: string;
  owner: string;
  ordinal: number;
  /** Top-left position, floated above the visible children's centroid. */
  position: IPoint;
}

/**
 * One ephemeral agent capsule (spec §WS event: `agent.spawn`,
 * unresolved children): a runtime sub-agent with no scanned node,
 * aggregated per (anchor, name) with a live-run count. Presentation
 * only, never a graph node.
 */
export interface ISpawnOverlayAgent {
  /** Synthetic Foblex node id (`vagent:<anchorId>|<name>`). */
  id: string;
  /** Foblex connector id of the anchor (node path or `session:<owner>`). */
  anchorId: string;
  /** The child unit's name, exactly as the runtime reported it. */
  name: string;
  /** The child unit's kind when the runtime reported one. */
  kind?: string;
  /** Live spawns aggregated into this capsule. */
  count: number;
  /**
   * Representative spawnId (the most recent live spawn of the group),
   * feeds the conversation click of the capsule's edge.
   */
  spawnId: string;
  /** Top-left position (dragged override, else rowed off the anchor). */
  position: IPoint;
}

export interface ISpawnOverlay {
  edges: readonly ISpawnOverlayEdge[];
  sessions: readonly ISpawnOverlaySession[];
  /** Ephemeral agent capsules for unresolved children. */
  agents: readonly ISpawnOverlayAgent[];
  /** Spawns riding an already-rendered static edge (no standalone edge). */
  activeOnStatic: readonly ISpawnActiveOnStatic[];
}

export const EMPTY_SPAWN_OVERLAY: ISpawnOverlay = {
  edges: [],
  sessions: [],
  agents: [],
  activeOnStatic: [],
};

export interface IResolveSpawnOverlayArgs {
  spawns: readonly ISpawnView[];
  sessions: readonly ISessionView[];
  /** Paths currently rendered on the canvas (facet ∩ curation). */
  visiblePaths: ReadonlySet<string>;
  /**
   * Directional `edgePairKey(from, to)` keys of the RENDERED static
   * edges (built from `graph().edges`, so edge-kind filters and
   * visibility already applied). A node-parent spawn whose exact
   * same-direction pair is here does not emit a standalone dashed
   * edge; it lands in `activeOnStatic` and the static edge takes the
   * live treatment instead. Reverse-direction pairs never suppress
   * (the arrowhead would point the wrong way), and session parents
   * never suppress (a session anchor has no static edge).
   */
  staticPairs: ReadonlySet<string>;
  /**
   * EFFECTIVE rendered position resolver, mirroring `projectVisible`:
   * user-pinned drag position wins over the dagre output. `undefined`
   * when the path has no resolvable position yet (layout pending).
   */
  positionOf: (path: string) => IPoint | undefined;
  /**
   * User-dragged session-anchor position, page-lifetime and ephemeral
   * (NEVER the persisted node-position store). When present it wins
   * over the derived centroid float, so an anchor the user moved stays
   * put while its children keep moving, and a session that reappears
   * comes back where the user left it.
   */
  sessionPositionOf?: (owner: string) => IPoint | undefined;
  /**
   * User-dragged agent-capsule position by capsule id, same ephemeral
   * contract as `sessionPositionOf`.
   */
  agentPositionOf?: (id: string) => IPoint | undefined;
  /**
   * The rendered project-instructions node (`AGENTS.md` / `CLAUDE.md`
   * at the scope root), when visible. Session anchors float beside it
   * (the visual affinity of spec §WS event: `agent.spawn`): a session
   * boots from the project instructions, so that card is its natural
   * visual home. Never a wire relation, purely placement.
   */
  instructionsPath?: string;
  /**
   * Whether unresolved children materialize agent capsules
   * (`ui.showRuntimeAgents`, default true). When `false` they stay
   * invisible, pre-capsule behavior: no capsule, no edge, and a session
   * with ONLY unresolved children renders no anchor.
   */
  showAgents?: boolean;
}

/** One (anchor, name) capsule group being accumulated. */
interface IVagentGroup {
  name: string;
  kind?: string;
  /** Most recent live spawn of the group (emission order). */
  spawnId: string;
  count: number;
}

export function resolveSpawnOverlay(args: IResolveSpawnOverlayArgs): ISpawnOverlay {
  const edges: ISpawnOverlayEdge[] = [];
  const activeOnStatic: ISpawnActiveOnStatic[] = [];
  /** Visible child positions per session owner, feeds the anchor float. */
  const childPointsBySession = new Map<string, IPoint[]>();
  /** Capsule groups per visible node anchor (insertion-ordered). */
  const vagentsByNode = new Map<string, Map<string, IVagentGroup>>();
  /** Capsule groups per session owner (insertion-ordered). */
  const vagentsBySession = new Map<string, Map<string, IVagentGroup>>();

  for (const spawn of args.spawns) {
    const child = spawn.childNodePath;
    if (child === undefined) {
      // Unresolved child: nothing scanned to target. With a name it
      // aggregates into an agent capsule; nameless there is nothing to
      // label, so it stays count-only (session surfaces). The operator
      // can opt the capsules off wholesale (`ui.showRuntimeAgents`).
      if (args.showAgents === false) continue;
      if (spawn.childName === undefined) continue;
      if (spawn.parentNodePath !== undefined) {
        if (!args.visiblePaths.has(spawn.parentNodePath)) continue;
        if (!args.positionOf(spawn.parentNodePath)) continue;
        addVagent(vagentsByNode, spawn.parentNodePath, spawn);
      } else {
        addVagent(vagentsBySession, spawn.parentSession ?? spawn.parentOwner, spawn);
      }
      continue;
    }
    // Child hidden by filters / curation: no edge can target it.
    if (!args.visiblePaths.has(child)) continue;
    const childPos = args.positionOf(child);
    if (!childPos) continue;

    if (spawn.parentNodePath !== undefined) {
      if (spawn.parentNodePath === child) continue; // self-spawn: drop
      if (!args.visiblePaths.has(spawn.parentNodePath)) continue;
      if (!args.positionOf(spawn.parentNodePath)) continue;
      const pairKey = edgePairKey(spawn.parentNodePath, child);
      if (args.staticPairs.has(pairKey)) {
        // The scan topology already draws this exact edge: the live
        // state overlays it instead of duplicating the arrow.
        activeOnStatic.push({ pairKey, spawnId: spawn.spawnId });
        continue;
      }
      edges.push({
        spawnId: spawn.spawnId,
        sourceId: `${spawn.parentNodePath}`,
        targetId: `${child}`,
        fromSession: false,
        pairKey,
      });
      continue;
    }

    const owner = spawn.parentSession ?? spawn.parentOwner;
    edges.push({
      spawnId: spawn.spawnId,
      sourceId: `${SESSION_NODE_ID_PREFIX}${owner}`,
      targetId: `${child}`,
      fromSession: true,
      // Session parents key by the raw OWNER (the server accumulator's
      // identity), never the synthetic `session:<owner>` node id.
      pairKey: edgePairKey(owner, child),
    });
    const points = childPointsBySession.get(owner) ?? [];
    points.push(childPos);
    childPointsBySession.set(owner, points);
  }

  // Instructions-node affinity anchor (position of the AGENTS.md /
  // CLAUDE.md card), when that node is actually rendered.
  const instructionsPos =
    args.instructionsPath !== undefined && args.visiblePaths.has(args.instructionsPath)
      ? args.positionOf(args.instructionsPath)
      : undefined;

  // Occupancy set for collision-aware placement: every visible node
  // card, then every overlay element as it is placed. Derived overlay
  // positions step away from anything already here, so ephemeral
  // chrome never sits ON a real card (or on a sibling anchor); a
  // user-dragged element skips the dodge (their drag is the override)
  // but still occupies, so derived siblings dodge IT.
  const occupied: IRect[] = [];
  for (const path of args.visiblePaths) {
    const p = args.positionOf(path);
    if (p) occupied.push({ x: p.x, y: p.y, w: NODE_WIDTH, h: NODE_HEIGHT });
  }

  const sessions: ISpawnOverlaySession[] = [];
  /** Session positions by owner, anchors the session-parented capsules. */
  const sessionPosByOwner = new Map<string, IPoint>();
  for (const session of args.sessions) {
    const points = childPointsBySession.get(session.owner);
    const hasEdges = points !== undefined && points.length > 0;
    // A session survives while >= 1 of its edges OR capsules does.
    if (!hasEdges && !vagentsBySession.has(session.owner)) continue;

    const dragged = args.sessionPositionOf?.(session.owner);
    let position: IPoint;
    if (dragged) {
      position = dragged;
      occupied.push({ ...dragged, w: SESSION_NODE_WIDTH, h: SESSION_NODE_HEIGHT });
    } else {
      // The float-above-children ceiling: a session reads top-down (it
      // SPAWNS its targets), so it must sit ABOVE every child it points
      // at, and its edges leave from its underside.
      let centerXSum = 0;
      let minChildY = Number.POSITIVE_INFINITY;
      if (hasEdges) {
        for (const p of points!) {
          centerXSum += p.x + NODE_WIDTH / 2;
          if (p.y < minChildY) minChildY = p.y;
        }
      }
      const ceilingY = minChildY - SESSION_NODE_GAP - SESSION_NODE_HEIGHT;

      let base: IPoint;
      if (instructionsPos) {
        // Affinity: float above the instructions card, CLAMPED above
        // the highest spawn target (an instructions card sitting below
        // a spawned agent must not drag the session under it, the
        // arrow would read upside down). Parallel sessions stack
        // upward through the occupancy dodge.
        base = {
          x: instructionsPos.x + NODE_WIDTH / 2 - SESSION_NODE_WIDTH / 2,
          y: Math.min(
            instructionsPos.y - SESSION_NODE_GAP - SESSION_NODE_HEIGHT,
            hasEdges ? ceilingY : Number.POSITIVE_INFINITY,
          ),
        };
      } else if (hasEdges) {
        // Centroid over the CARD CENTERS (positions are top-left), then
        // float the capsule a fixed gap above the highest child.
        base = {
          x: centerXSum / points!.length - SESSION_NODE_WIDTH / 2,
          y: ceilingY,
        };
      } else {
        // Only capsules and no instructions node: hover above the
        // visible graph's top edge so the capsule chain has a home.
        base = graphTopCenterFallback(args);
      }
      // Sessions live above content, so upward is the free direction.
      position = placeClear(
        { ...base, w: SESSION_NODE_WIDTH, h: SESSION_NODE_HEIGHT },
        -(SESSION_NODE_HEIGHT + SESSION_NODE_STACK_GAP),
        occupied,
      );
    }
    sessions.push({
      id: `${SESSION_NODE_ID_PREFIX}${session.owner}`,
      owner: session.owner,
      ordinal: session.ordinal,
      position,
    });
    sessionPosByOwner.set(session.owner, position);
  }

  // Agent capsules, positioned off their (already-placed) anchors.
  const agents: ISpawnOverlayAgent[] = [];
  for (const [anchorPath, groups] of vagentsByNode) {
    const anchorPos = args.positionOf(anchorPath)!;
    // Below the parent card, where children sit in the top-down layout;
    // the downward dodge steps past the real children already there.
    rowCapsules(agents, edges, args, groups, occupied, {
      anchorId: anchorPath,
      pairIdentity: anchorPath,
      fromSession: false,
      centerX: anchorPos.x + NODE_WIDTH / 2,
      y: anchorPos.y + NODE_HEIGHT + VAGENT_NODE_GAP,
      stepY: VAGENT_NODE_HEIGHT + SESSION_NODE_STACK_GAP,
    });
  }
  for (const [owner, groups] of vagentsBySession) {
    const anchorPos = sessionPosByOwner.get(owner);
    if (!anchorPos) continue; // defensive: the session always rendered above
    // Below the session capsule, tucked into the gap the session keeps
    // over the content: the session is guaranteed to sit ABOVE its
    // targets, so everything it runs hangs under it and every edge
    // flows top-down. The downward dodge steps past whatever card sits
    // underneath (the instructions card in the affinity spot).
    rowCapsules(agents, edges, args, groups, occupied, {
      anchorId: `${SESSION_NODE_ID_PREFIX}${owner}`,
      pairIdentity: owner,
      fromSession: true,
      centerX: anchorPos.x + SESSION_NODE_WIDTH / 2,
      y: anchorPos.y + SESSION_NODE_HEIGHT + SESSION_NODE_STACK_GAP,
      stepY: VAGENT_NODE_HEIGHT + SESSION_NODE_STACK_GAP,
    });
  }

  return { edges, sessions, agents, activeOnStatic };
}

/** Accumulate one unresolved-child spawn into its (anchor, name) group. */
function addVagent(
  buckets: Map<string, Map<string, IVagentGroup>>,
  anchorKey: string,
  spawn: ISpawnView,
): void {
  const groups = buckets.get(anchorKey) ?? new Map<string, IVagentGroup>();
  const name = spawn.childName!;
  const group = groups.get(name);
  if (group) {
    group.count++;
    // Emission order makes the most recent spawn the representative,
    // mirroring the static-edge riding rule.
    group.spawnId = spawn.spawnId;
    if (group.kind === undefined) group.kind = spawn.childKind;
  } else {
    groups.set(name, { name, kind: spawn.childKind, spawnId: spawn.spawnId, count: 1 });
  }
  buckets.set(anchorKey, groups);
}

/**
 * Lay one anchor's capsule groups out as a centered horizontal row and
 * emit each capsule plus its dashed anchor -> capsule edge. The row is
 * collision-dodged AS A UNIT (stepping along `stepY` until its band is
 * clear of `occupied`), so siblings stay aligned. A dragged capsule
 * keeps its override position but stays in the row's slot accounting,
 * so its siblings do not reflow when one is moved.
 */
function rowCapsules(
  agents: ISpawnOverlayAgent[],
  edges: ISpawnOverlayEdge[],
  args: IResolveSpawnOverlayArgs,
  groups: ReadonlyMap<string, IVagentGroup>,
  occupied: IRect[],
  row: {
    anchorId: string;
    /** Pair-key identity of the anchor (raw owner for sessions). */
    pairIdentity: string;
    fromSession: boolean;
    centerX: number;
    y: number;
    /** Dodge direction: downward for node anchors, upward for sessions. */
    stepY: number;
  },
): void {
  const total = groups.size * VAGENT_NODE_WIDTH + (groups.size - 1) * VAGENT_NODE_SPREAD;
  const placed = placeClear(
    { x: row.centerX - total / 2, y: row.y, w: total, h: VAGENT_NODE_HEIGHT },
    row.stepY,
    occupied,
  );
  let x = placed.x;
  for (const group of groups.values()) {
    const id = `${VAGENT_NODE_ID_PREFIX}${row.anchorId}|${group.name}`;
    const dragged = args.agentPositionOf?.(id);
    const position = dragged ?? { x, y: placed.y };
    if (dragged) occupied.push({ ...dragged, w: VAGENT_NODE_WIDTH, h: VAGENT_NODE_HEIGHT });
    x += VAGENT_NODE_WIDTH + VAGENT_NODE_SPREAD;
    agents.push({
      id,
      anchorId: row.anchorId,
      name: group.name,
      kind: group.kind,
      count: group.count,
      spawnId: group.spawnId,
      position,
    });
    edges.push({
      spawnId: group.spawnId,
      sourceId: row.anchorId,
      targetId: id,
      fromSession: row.fromSession,
      // Deterministic and collision-free with real pairs (the `vagent:`
      // prefix cannot appear in a node path): the server accumulator
      // only counts RESOLVED children (spec §Execution stats), so this
      // key never matches a pair entry and the convo pill stays off.
      pairKey: edgePairKey(row.pairIdentity, id),
    });
  }
}

/**
 * Fallback session position when the session has ONLY capsules and no
 * instructions node is rendered: centered above the visible graph's
 * top edge (double the usual gap so it reads as hovering over the
 * project, not over one card). An empty canvas lands at the origin.
 * Parallel sessions separate through the occupancy dodge downstream.
 */
function graphTopCenterFallback(args: IResolveSpawnOverlayArgs): IPoint {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const path of args.visiblePaths) {
    const pos = args.positionOf(path);
    if (!pos) continue;
    if (pos.x < minX) minX = pos.x;
    if (pos.x + NODE_WIDTH > maxX) maxX = pos.x + NODE_WIDTH;
    if (pos.y < minY) minY = pos.y;
  }
  if (minX === Number.POSITIVE_INFINITY) return { x: 0, y: 0 };
  return {
    x: (minX + maxX) / 2 - SESSION_NODE_WIDTH / 2,
    y: minY - 2 * SESSION_NODE_GAP - SESSION_NODE_HEIGHT,
  };
}

/** An occupied axis-aligned box, in canvas units. */
interface IRect extends IPoint {
  w: number;
  h: number;
}

/**
 * Breathing room around every occupied box: a candidate closer than
 * this to a card (or a sibling anchor) counts as touching it.
 */
const OVERLAY_CLEARANCE = 8;

/** Whether `candidate` (inflated by the clearance) touches any rect. */
function intersectsAny(candidate: IRect, occupied: readonly IRect[]): boolean {
  for (const r of occupied) {
    if (
      candidate.x < r.x + r.w + OVERLAY_CLEARANCE &&
      candidate.x + candidate.w + OVERLAY_CLEARANCE > r.x &&
      candidate.y < r.y + r.h + OVERLAY_CLEARANCE &&
      candidate.y + candidate.h + OVERLAY_CLEARANCE > r.y
    ) {
      return true;
    }
  }
  return false;
}

/**
 * How many dodge steps `placeClear` tries before giving up and keeping
 * the last candidate (a best-effort overlap beats an unbounded walk
 * off-canvas on a pathologically dense map).
 */
const MAX_DODGE_STEPS = 8;

/**
 * Collision-aware placement: keep the preferred `base` box when it is
 * clear, else step it along `stepY` (down for below-anchor rows, up
 * for above-content anchors) until it stops touching anything. The
 * final box joins `occupied` either way, so later placements dodge it.
 */
function placeClear(base: IRect, stepY: number, occupied: IRect[]): IPoint {
  const candidate = { ...base };
  for (let step = 0; step < MAX_DODGE_STEPS && intersectsAny(candidate, occupied); step++) {
    candidate.y += stepY;
  }
  occupied.push(candidate);
  return { x: candidate.x, y: candidate.y };
}
