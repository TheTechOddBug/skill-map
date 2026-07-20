/**
 * Pure projection from live spawn state (`AgentSpawnService`) to the
 * graph's ephemeral overlay: dashed spawn edges plus floating session
 * anchors.
 *
 * LAYERED BESIDE `graph()` on purpose: nothing here ever reaches
 * `fullLayout`, the reconciler, persisted positions, or the fit bbox.
 * Session ids are synthetic (`session:<owner>`), never node paths, so
 * an accidental leak into any path-keyed structure is loudly visible.
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
 *   - a session anchor renders only while >= 1 of its edges survives,
 *     and floats above the centroid of its visible children.
 *
 * Connector id contract: node endpoints reuse the SAME unified fConnector
 * connector ids the scan-link edges use (Foblex connections are
 * connector-to-connector and connectors are shared); session anchors
 * own their single `session:<owner>-out` output.
 */

import { activityPairKeyOf } from '../../../models/api';
import type { ISessionView, ISpawnView } from '../../../services/agent-spawn';
import { NODE_WIDTH, type IPoint } from './graph-layout';

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

export interface ISpawnOverlay {
  edges: readonly ISpawnOverlayEdge[];
  sessions: readonly ISpawnOverlaySession[];
  /** Spawns riding an already-rendered static edge (no standalone edge). */
  activeOnStatic: readonly ISpawnActiveOnStatic[];
}

export const EMPTY_SPAWN_OVERLAY: ISpawnOverlay = {
  edges: [],
  sessions: [],
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
}

export function resolveSpawnOverlay(args: IResolveSpawnOverlayArgs): ISpawnOverlay {
  const edges: ISpawnOverlayEdge[] = [];
  const activeOnStatic: ISpawnActiveOnStatic[] = [];
  /** Visible child positions per session owner, feeds the anchor float. */
  const childPointsBySession = new Map<string, IPoint[]>();

  for (const spawn of args.spawns) {
    const child = spawn.childNodePath;
    // Unresolved child (name never matched a scanned node) or a child
    // hidden by filters / curation: no edge can target it.
    if (child === undefined || !args.visiblePaths.has(child)) continue;
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

  const sessions: ISpawnOverlaySession[] = [];
  for (const session of args.sessions) {
    const points = childPointsBySession.get(session.owner);
    if (!points || points.length === 0) continue; // no surviving edge, no anchor
    const dragged = args.sessionPositionOf?.(session.owner);
    if (dragged) {
      sessions.push({
        id: `${SESSION_NODE_ID_PREFIX}${session.owner}`,
        owner: session.owner,
        ordinal: session.ordinal,
        position: dragged,
      });
      continue;
    }
    // Centroid over the CARD CENTERS (positions are top-left), then
    // float the capsule a fixed gap above the highest child.
    let centerXSum = 0;
    let minY = Number.POSITIVE_INFINITY;
    for (const p of points) {
      centerXSum += p.x + NODE_WIDTH / 2;
      if (p.y < minY) minY = p.y;
    }
    const centroidX = centerXSum / points.length;
    sessions.push({
      id: `${SESSION_NODE_ID_PREFIX}${session.owner}`,
      owner: session.owner,
      ordinal: session.ordinal,
      position: {
        x: centroidX - SESSION_NODE_WIDTH / 2,
        y: minY - SESSION_NODE_GAP - SESSION_NODE_HEIGHT,
      },
    });
  }

  return { edges, sessions, activeOnStatic };
}
