/**
 * Pure layout / projection helpers for the graph view.
 *
 * Two responsibilities:
 *
 *   1. **`resolveTopology()`**, sync builder that walks the loaded
 *      nodes + scan and emits the resolved edge set (filter to valid
 *      endpoints, dedupe, resolve triggers to paths) plus indexed
 *      lookup maps. Pure, deterministic, cheap, called on every
 *      `loader.nodes()` / `loader.scan()` change.
 *
 *   2. **`computeDagreLayout()`**, async wrapper around Foblex's
 *      `DagreLayoutEngine.calculate()`. Returns a top-left `path →
 *      point` map sized so the dagre output centres align with the
 *      card centres (dagre returns centres; our `[fNodePosition]`
 *      expects top-left).
 *
 *   3. **`projectVisible()`**, pure filter-time projection from the
 *      cached layout to the visible subset, layering manual drag
 *      overrides on top of dagre's positions.
 *
 * Layout history: this module used d3-force until 2026-05; the
 * hand-tuned force simulation worked for small graphs but nested
 * heavily once the loaded set grew past ~30 nodes. Foblex ships
 * official layout engines (dagre, ELK) as opt-in plugin packages;
 * dagre's hierarchical packing avoids the nesting without us
 * maintaining a force-simulation tuning. ELK is available upstream
 * but adds a few MB of bundle weight, holding off until a user asks
 * for it.
 */

import { DagreLayoutEngine } from '@foblex/flow-dagre-layout';
import type {
  IFLayoutConnection,
  IFLayoutNode,
} from '@foblex/flow';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from 'd3-force';

import type {
  IReportSafety,
  INodeStats,
  INodeView,
  ISummaryMarkdown,
  TNodeKind,
  TSummary,
} from '../../../models/node';
import type { ILinkApi, INodeApi, IScanResultApi, TLinkKindApi } from '../../../models/api';
import { buildNameIndex, resolveTargetToPath } from '../../../services/trigger-resolve';
import {
  LAYOUT_SPACING_VALUES,
  toFoblexAlgorithm,
  toFoblexDirection,
  type TLayoutAlgorithm,
  type TLayoutDirection,
  type TLayoutSpacing,
} from './layout-controls';

/**
 * Layout footprint for `<sm-node-card>` in its collapsed state. Fed to
 * the dagre engine so it reserves enough room around each card to
 * avoid overlap. Height is generous because the card grows when the
 * user expands the panel, keeping the collapsed footprint a bit taller
 * avoids re-layout jitter for the common-case mid-expand. Update if
 * the card's collapsed dimensions change in `node-card.css`
 * (`:host { width: ... }` and the main row).
 */
export const NODE_WIDTH = 260;
export const NODE_HEIGHT = 120;

export interface IPoint {
  x: number;
  y: number;
}

/**
 * Per-node position entry. Extends `IPoint` with a `manual` flag that
 * distinguishes user-drag pins from auto-assignments seeded by dagre
 * during reconcile. Reconcile preserves manual pins across topology
 * changes; auto pins follow the freshest dagre output so adding /
 * removing a node never traps an existing node under the new arrival
 * (the "pisar nodo" symptom the user reported). Missing on storage
 * read defaults to `false` so pins persisted before the field existed
 * behave like auto pins, the user can re-drag any that mattered.
 */
export interface IStoredNodePosition extends IPoint {
  manual?: boolean;
}

/**
 * Per-node position cache. Keyed by `node.path`, lives in the graph
 * view as a `WritableSignal<TNodePositions>` plus a localStorage
 * mirror. `Map` (vs the prior `Record<string, IPoint>`) makes
 * in-place mutation visibly wrong: every reconcile / drag flush
 * builds a new map and the signal swaps the reference, so an
 * accidental `positions()[id] = ...` from a future caller no longer
 * silently bypasses Angular's change detection.
 */
export type TNodePositions = Map<string, IStoredNodePosition>;
export type TReadonlyNodePositions = ReadonlyMap<string, IStoredNodePosition>;

export type TEdgeKind = TLinkKindApi;

export interface IGraphNode {
  id: string;
  path: string;
  /** Full parsed node, passed to <sm-node-card>. */
  view: INodeView;
  kind: TNodeKind;
  position: IPoint;
  /** Footer / subtitle stats. Computed during layout projection. */
  stats: INodeStats;
  /**
   * Deterministic mock summary so the LLM cluster on the card renders
   * during the in-browser prototype phase. Replaced by kernel-emitted
   * `TSummary` once `sm summarize` lands.
   */
  summary: TSummary;
}

export interface IGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: TEdgeKind;
  /**
   * Numeric `[0..1]` confidence carried from `Link.confidence` so the
   * `<f-connection>` template can map it to edge opacity. When several
   * links collapse into one edge (same source / target / kind), the
   * MAX confidence wins, the operator's eye should follow the
   * strongest signal rather than the noisiest one.
   */
  confidence: number;
}

export interface IGraphData {
  nodes: IGraphNode[];
  edges: IGraphEdge[];
}

/**
 * Topology view: indexed lookups plus the resolved edge set. Computed
 * synchronously from `loader.nodes()` + `loader.scan()`. Carries no
 * positions; layout positions live in their own signal updated by the
 * async dagre effect.
 */
export interface ITopology {
  /** Node views indexed by path, handy to project without re-iterating. */
  nodesByPath: Map<string, INodeView>;
  /** BFF-shaped node rows by path, used to read persisted byte/token counts. */
  apiNodesByPath: Map<string, INodeApi>;
  /** Deduped, valid edges (both endpoints present in the loaded set). */
  edges: IGraphEdge[];
}

export interface IFullLayout extends ITopology {
  /** Dagre-computed top-left positions for every loaded node. */
  positions: Map<string, IPoint>;
  /** `performance.now()` timestamp when this layout was computed. */
  computedAt: number;
}

export interface ILayoutPreferences {
  readonly algorithm: TLayoutAlgorithm;
  readonly direction: TLayoutDirection;
  readonly spacing: TLayoutSpacing;
}

/**
 * Compute a topology fingerprint from the resolved (filtered + deduped)
 * edge set and the full path list. Two inputs that produce the same
 * fingerprint are guaranteed to produce the same dagre layout, kind /
 * frontmatter / title / hash changes do NOT participate, so editing a
 * node's content leaves the fingerprint untouched and the cached
 * positions get reused.
 *
 * Exported for tests; consumed by the graph view's layout effect to
 * skip relayouts when topology has not actually changed.
 */
export function topologyFingerprint(allNodes: INodeView[], edges: IGraphEdge[]): string {
  const paths = allNodes.map((n) => n.path).sort();
  const edgeIds = edges.map((e) => e.id).sort();
  return `${paths.length}|${paths.join(',')}|${edgeIds.length}|${edgeIds.join(',')}`;
}

/**
 * Build the resolved edge set + index maps for a loaded `(nodes, scan)`
 * pair. Pure: same input order produces the same output. Cheap to call
 * on every change-detection pass; the graph view memoises it via a
 * `computed` so consumers re-read the same instance on no-op updates.
 *
 * Edges come straight from the persisted `ScanResult.links` (kernel
 * extractor output). Until the BFF starts emitting links, `scan` may
 * be `null`, in that case the topology has zero edges and the graph
 * renders disconnected nodes.
 */
export function resolveTopology(
  allNodes: INodeView[],
  scan: IScanResultApi | null,
): ITopology {
  const validPaths = new Set(allNodes.map((n) => n.path));
  // Trigger → path index built from the same source-of-truth the
  // kernel's `broken-ref` uses (`frontmatter.name` normalised). The
  // `slash` and `at-directive` extractors emit `link.target` as a
  // bare trigger (`/full-command-claude`, `@my-agent`), so the graph
  // needs this lookup to draw the arrow between the real node cards.
  // Path-style targets (markdown-link, annotations) bypass the
  // resolver and go through unchanged.
  const nameIndex = buildNameIndex(allNodes);
  const byId = new Map<string, IGraphEdge>();
  const links: ILinkApi[] = scan?.links ?? [];
  for (const link of links) {
    if (!validPaths.has(link.source)) continue;
    const resolvedTarget = resolveTargetToPath(
      link.target,
      link.trigger?.normalizedTrigger ?? null,
      nameIndex,
    );
    if (!validPaths.has(resolvedTarget)) continue;
    if (link.source === resolvedTarget) continue;
    const id = edgeId(link.kind, link.source, resolvedTarget);
    const linkConfidence = typeof link.confidence === 'number' ? link.confidence : 0.6;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        from: link.source,
        to: resolvedTarget,
        kind: link.kind,
        confidence: linkConfidence,
      });
    } else if (linkConfidence > existing.confidence) {
      // Higher-confidence emission for the same edge wins, see the
      // doc on `IGraphEdge.confidence`. Mutation is safe; the map's
      // identity is the only consumer here.
      existing.confidence = linkConfidence;
    }
  }
  const edges = [...byId.values()];

  const nodesByPath = new Map<string, INodeView>();
  for (const n of allNodes) nodesByPath.set(n.path, n);
  const apiNodesByPath = new Map<string, INodeApi>();
  for (const n of scan?.nodes ?? []) apiNodesByPath.set(n.path, n);

  return { nodesByPath, apiNodesByPath, edges };
}

/**
 * Run Foblex's dagre engine over the loaded set and return a
 * `path → topLeftPoint` map.
 *
 * Coordinate convention: Foblex's layout result is keyed on node id
 * with positions at the node's TOP-LEFT corner. Our `[fNodePosition]`
 * binding expects the same shape, so the return value is used as-is.
 *
 * Disconnected sub-graphs: dagre returns positions for every input
 * node, including isolates (nodes with no edges). They land at row 0
 * next to the connected components; for our use case that is good
 * enough, the d3-force layout we replaced also clustered isolates near
 * the origin via `forceX(0) / forceY(0)`.
 */
export async function computeDagreLayout(
  engine: DagreLayoutEngine,
  allNodes: INodeView[],
  edges: IGraphEdge[],
  preferences: ILayoutPreferences,
): Promise<Map<string, IPoint>> {
  const size = { width: NODE_WIDTH, height: NODE_HEIGHT };
  const layoutNodes: IFLayoutNode[] = allNodes.map((n) => ({ id: n.path, size }));
  const layoutConnections: IFLayoutConnection[] = edges.map((e) => ({
    source: e.from,
    target: e.to,
  }));

  const spacing = LAYOUT_SPACING_VALUES[preferences.spacing];
  const result = await engine.calculate(layoutNodes, layoutConnections, {
    algorithm: toFoblexAlgorithm(preferences.algorithm),
    direction: toFoblexDirection(preferences.direction),
    nodeGap: spacing.nodeGap,
    layerGap: spacing.layerGap,
  });

  const positions = new Map<string, IPoint>();
  for (const { id, position } of result.nodes) {
    positions.set(id, { x: position.x, y: position.y });
  }
  return positions;
}

/**
 * Run a d3-force simulation over the loaded set and return a
 * `path → topLeftPoint` map. Used by the "Organic" layout option,
 * where the user wants a physics-based arrangement (repulsion +
 * spring-like edges) instead of a layered hierarchy. No `direction`
 * concept here, the toolbar disables that button when force is
 * active.
 *
 * Coordinate convention: d3-force works in CENTRE coordinates, but
 * Foblex's `[fNodePosition]` expects TOP-LEFT. The offset by
 * `NODE_WIDTH/2` / `NODE_HEIGHT/2` happens at the end so the rest of
 * the pipeline stays uniform with the dagre output.
 *
 * Tuning rationale: same numbers we ran in production from the
 * v0.x line, they survived the months of iteration and still feel
 * right for skill-map-sized graphs (10-300 nodes):
 *   - `linkDistance: 90` ≈ NODE_WIDTH so connected nodes sit roughly
 *     one card-width apart.
 *   - `chargeStrength: -200` is moderate repulsion (default is -30,
 *     way too soft; -350 was strong enough to fling disconnected
 *     nodes off-screen).
 *   - `forceCenter` only TRANSLATES (per d3-force docs, it shifts the
 *     centroid to origin but doesn't restrain spread). Real "gravity"
 *     comes from `forceX(0)` / `forceY(0)` which apply velocity
 *     towards the origin every tick. Strength 0.06 gives a gentle
 *     pull that reins in disconnected nodes without squashing
 *     connected clusters.
 *   - `collideRadius: NODE_WIDTH/2 + 12` adds a 12 px gutter around
 *     each node so labels don't kiss.
 *   - 400 ticks is past d3-force's default cooling threshold (300),
 *     the cloud is fully settled.
 *
 * Deterministic: d3-force seeds initial positions via phyllotaxis
 * (no Math.random), so the same input produces the same output. Tests
 * can rely on stable positions.
 */
export function computeForceLayoutPositions(
  allNodes: INodeView[],
  edges: IGraphEdge[],
): Map<string, IPoint> {
  interface ISimNode extends SimulationNodeDatum {
    id: string;
  }
  interface ISimLink {
    source: string;
    target: string;
  }
  const simNodes: ISimNode[] = allNodes.map((n) => ({ id: n.path }));
  const simLinks: ISimLink[] = edges.map((e) => ({ source: e.from, target: e.to }));

  const sim = forceSimulation<ISimNode>(simNodes)
    .force(
      'link',
      forceLink<ISimNode, ISimLink>(simLinks).id((d) => d.id).distance(90).strength(1),
    )
    .force('charge', forceManyBody<ISimNode>().strength(-200))
    .force('center', forceCenter(0, 0))
    .force('x', forceX<ISimNode>(0).strength(0.06))
    .force('y', forceY<ISimNode>(0).strength(0.06))
    .force('collide', forceCollide<ISimNode>(NODE_WIDTH / 2 + 12))
    .stop();

  const TICKS = 400;
  for (let i = 0; i < TICKS; i++) sim.tick();

  const positions = new Map<string, IPoint>();
  for (const sn of simNodes) {
    positions.set(sn.id, {
      x: (sn.x ?? 0) - NODE_WIDTH / 2,
      y: (sn.y ?? 0) - NODE_HEIGHT / 2,
    });
  }
  return positions;
}

/**
 * Project the cached layout to the visible subset. Pure projection,
 * no relayout. Manual drag positions (`stored`) override the cached
 * layout position per node. Edge link counts are computed against
 * visible-only edges so the in/out badges reflect what the user can
 * see.
 */
export function projectVisible(
  layout: IFullLayout,
  visibleIds: Set<string>,
  stored: TNodePositions,
  visibleEdgeKinds: ReadonlySet<TLinkKindApi> | null = null,
): IGraphData {
  const visibleEdges = layout.edges.filter(
    (e) =>
      visibleIds.has(e.from) &&
      visibleIds.has(e.to) &&
      (visibleEdgeKinds === null || visibleEdgeKinds.has(e.kind)),
  );

  const outCount = new Map<string, number>();
  const inCount = new Map<string, number>();
  for (const e of visibleEdges) {
    outCount.set(e.from, (outCount.get(e.from) ?? 0) + 1);
    inCount.set(e.to, (inCount.get(e.to) ?? 0) + 1);
  }

  const nodes: IGraphNode[] = [];
  for (const id of visibleIds) {
    const view = layout.nodesByPath.get(id);
    if (!view) continue;
    const apiNode = layout.apiNodesByPath.get(id);
    const override = stored.get(id);
    const cached = layout.positions.get(id) ?? { x: 0, y: 0 };
    const position = override ? { x: override.x, y: override.y } : cached;
    nodes.push({
      id,
      path: id,
      view,
      kind: view.kind,
      position,
      stats: {
        linksIn: inCount.get(id) ?? 0,
        linksOut: outCount.get(id) ?? 0,
        // BFF-persisted counts. Older snapshots / partial scans may omit
        // tokens; default to undefined so the card hides the pill cleanly.
        bytesTotal: apiNode?.bytes.total,
        tokensTotal: apiNode?.tokens?.total,
        externalRefsCount: apiNode?.externalRefsCount,
      },
      summary: deriveStubSummary(view),
    });
  }

  return { nodes, edges: visibleEdges };
}

/**
 * Lightweight stand-in for the kernel's per-kind summarizer (Step 9+).
 * `<sm-node-card>` requires a `TSummary`, once the real summarizer
 * lands, this collapses to a no-op and the kernel's payload flows
 * through verbatim.
 */
function deriveStubSummary(view: INodeView): TSummary {
  const safety: IReportSafety = {
    injectionDetected: false,
    contentQuality: 'clean',
  };
  const whatItDoes = (view.frontmatter.description ?? view.frontmatter.name ?? '').trim();
  const stub: ISummaryMarkdown = {
    kind: 'markdown',
    confidence: 0.6,
    safety,
    whatItCovers: whatItDoes || `${view.kind} entry`,
    topics: [],
    keyFacts: [],
  };
  return stub;
}

function edgeId(prefix: string, from: string, to: string): string {
  // Direction matters, A→B and B→A are distinct edges so the graph
  // renders both arrows (entering from the top, leaving from the
  // bottom) when two nodes reference each other. Dedup still kicks in
  // when the SAME directed link appears twice (multi-extractor
  // collision), since the id is fully deterministic on (kind, from,
  // to).
  return `${prefix}:${from}::${to}`;
}
