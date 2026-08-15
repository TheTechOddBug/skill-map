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
import { edgeId, edgeTargetPath } from '../../../services/link-analysis';
import {
  FILESYSTEM_SPACING_VALUES,
  LAYOUT_SPACING_VALUES,
  toFoblexAlgorithm,
  toFoblexDirection,
  type IFilesystemSpacingValues,
  type ILayoutSpacingValues,
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

// The link-to-edge resolution primitives (`edgeId`, `edgeTargetPath`)
// and the per-reason breakdown (`analyzeLinks`, `ILinkAnalysis`) live
// in `services/link-analysis.ts`: the topbar consumes the breakdown,
// and the shell must not import from this feature view's internals.
// `resolveTopology` below imports the same primitives so the drawn
// set and the breakdown can never disagree.

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
  // Edge endpoints come from `link.resolvedTarget`, the path the kernel
  // already resolved each `slash` / `at-directive` trigger to (see
  // `edgeTargetPath`). The graph draws the arrow between the real node
  // cards without re-running resolution; path-style targets and
  // unresolved triggers fall back to `link.target` and get dropped by
  // the `validPaths` check below when they name no loaded node.
  const byId = new Map<string, IGraphEdge>();
  const links: ILinkApi[] = scan?.links ?? [];
  for (const link of links) {
    if (!validPaths.has(link.source)) continue;
    const resolvedTarget = edgeTargetPath(link);
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
 * (no Math.random; jiggle uses d3's per-simulation LCG), so the same
 * input produces the same output. Tests can rely on stable positions.
 *
 * `seed` (optional) turns the run into an INCREMENTAL relayout: nodes
 * present in the map are PINNED at their previous position (`fx`/`fy`,
 * which d3-force restores after every tick) and newcomers start at the
 * centroid of their already-seeded neighbours (collide separates
 * coincident starts deterministically), so only the newcomers move.
 * The live-lens membership churns node by node; a survivor that drifts
 * even a little while a neighbour joins reads as flicker, so "minimal
 * drift" is not enough, it has to be zero. For the same reason the
 * incremental run drops `forceCenter` / `forceX` / `forceY`: those
 * translate or pull the WHOLE cloud, which with pinned survivors would
 * only shear the newcomers against a frame that never moves. The pinned
 * cloud is its own anchor. Seed points are TOP-LEFT (same convention as
 * the returned map).
 */
export function computeForceLayoutPositions(
  allNodes: INodeView[],
  edges: IGraphEdge[],
  seed?: ReadonlyMap<string, IPoint>,
): Map<string, IPoint> {
  interface ISimNode extends SimulationNodeDatum {
    id: string;
  }
  interface ISimLink {
    source: string;
    target: string;
  }
  const simNodes: ISimNode[] = allNodes.map((n) => {
    const prev = seed?.get(n.path);
    if (prev === undefined) return { id: n.path };
    const x = prev.x + NODE_WIDTH / 2;
    const y = prev.y + NODE_HEIGHT / 2;
    // Pinned, not merely pre-positioned: a survivor must not move at all.
    return { id: n.path, x, y, fx: x, fy: y };
  });
  const simLinks: ISimLink[] = edges.map((e) => ({ source: e.from, target: e.to }));

  const anySeeded = simNodes.some((sn) => sn.x !== undefined);
  if (anySeeded) {
    const byId = new Map(simNodes.map((sn) => [sn.id, sn]));
    for (const sn of simNodes) {
      if (sn.x !== undefined) continue;
      let sumX = 0;
      let sumY = 0;
      let placed = 0;
      for (const e of edges) {
        const otherId = e.from === sn.id ? e.to : e.to === sn.id ? e.from : undefined;
        if (otherId === undefined) continue;
        const other = byId.get(otherId);
        if (other?.x === undefined || other.y === undefined) continue;
        sumX += other.x;
        sumY += other.y;
        placed += 1;
      }
      if (placed > 0) {
        sn.x = sumX / placed;
        sn.y = sumY / placed;
      }
    }
  }

  const sim = forceSimulation<ISimNode>(simNodes)
    .force(
      'link',
      forceLink<ISimNode, ISimLink>(simLinks).id((d) => d.id).distance(90).strength(1),
    )
    .force('charge', forceManyBody<ISimNode>().strength(-200))
    .force('collide', forceCollide<ISimNode>(NODE_WIDTH / 2 + 12))
    .stop();

  // Whole-cloud framing forces belong to the cold-start run only: with
  // pinned survivors they cannot move the frame, they would only drag
  // the newcomers towards an origin the rest of the cloud ignores.
  if (!anySeeded) {
    sim
      .force('center', forceCenter(0, 0))
      .force('x', forceX<ISimNode>(0).strength(0.06))
      .force('y', forceY<ISimNode>(0).strength(0.06));
  }

  // Seeded runs start mid-cooling: only the newcomers are free, and
  // they settle against a frozen cloud in far fewer ticks.
  if (anySeeded) sim.alpha(0.35);
  const TICKS = anySeeded ? 120 : 400;
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
 * One directory while the filesystem layout is being built: the files
 * sitting directly in it, plus its subdirectories by name. Directories
 * are NOT nodes (skill-map has no folder node), they exist only as the
 * scaffolding this layout walks.
 */
interface IDirTree {
  files: INodeView[];
  children: Map<string, IDirTree>;
}

function emptyDir(): IDirTree {
  return { files: [], children: new Map() };
}

/**
 * Build the directory tree implied by the node paths. Paths are
 * POSIX-relative (`docs/guide.md`, `.claude/skills/foo/SKILL.md`), so
 * splitting on `/` is the whole story; no platform separator handling
 * belongs here. Intermediate directories that hold no file of their own
 * still materialise, which is what keeps a node's column equal to its
 * real depth.
 */
function buildDirTree(allNodes: INodeView[]): IDirTree {
  const root = emptyDir();
  for (const node of allNodes) {
    const segments = node.path.split('/');
    // The last segment is the file itself, everything before it is the
    // directory chain that leads to it.
    let dir = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const name = segments[i] ?? '';
      let next = dir.children.get(name);
      if (!next) {
        next = emptyDir();
        dir.children.set(name, next);
      }
      dir = next;
    }
    dir.files.push(node);
  }
  return root;
}

/**
 * Place one directory's subtree and answer the last row it touched.
 *
 * Reading order matches the files panel exactly (`files-view.rows.ts`,
 * `buildTreeRows`): subfolders first, then the folder's OWN files, at
 * every level including the root. In a linear list that ordering is
 * free, it is just what comes first; on a canvas the two live in
 * different columns and never compete for a row, so "after" has to be
 * spelled out as "below everything the subfolders occupied", which is
 * what `deepest` carries back up. The visible payoff is the one the
 * user asked for: loose files at a level sit at the FOOT of their
 * column, under the folders, instead of floating above them.
 *
 * Columns still share one cursor per depth (`nextFree`) rather than
 * reserving an exclusive band per branch, so two branches can occupy
 * the same rows whenever their columns differ.
 *
 * Cost, measured on this repo's 284 markdown nodes and accepted by the
 * user with the number in hand: 418 rows, against 126 when a folder's
 * own files were allowed to sit level with its subfolders. Pushing the
 * files below the subtree makes branch heights add up again, so this is
 * the tall end of the trade-off, chosen for fidelity to the files
 * panel. Do not "optimise" it back to the compact form without asking:
 * the compact form was built, measured, shown, and rejected.
 *
 * `folderGap` of vertical air trails a folder's own run so sibling
 * folders in a column read as blocks rather than one undifferentiated
 * list. It is a gap in its OWN right, not "one more row": deriving it
 * from the row pitch chained it to `nodeGap` and made the air inside a
 * folder impossible to tune without moving the boundary between folders
 * with it, which is exactly the complaint that split them (user call).
 *
 * Y is tracked in PIXELS rather than row indices for the same reason:
 * once two different vertical gaps exist, "rows" stop being a unit that
 * can express the layout.
 */
function placeDirTree(
  dir: IDirTree,
  depth: number,
  minY: number,
  positions: Map<string, IPoint>,
  pitch: { column: number; row: number; folderGap: number },
  nextFree: number[],
  filesBelowSubfolders: boolean,
): number {
  const startY = Math.max(nextFree[depth] ?? 0, minY);
  const x = depth * pitch.column;
  const sortedFiles = [...dir.files].sort((a, b) => a.path.localeCompare(b.path));
  const sortedChildren = [...dir.children.keys()].sort((a, b) => a.localeCompare(b));

  const placeOwnFiles = (from: number): number => {
    let y = from;
    for (const file of sortedFiles) {
      positions.set(file.path, { x, y });
      y += pitch.row;
    }
    // The folder separator is only owed when this folder actually put
    // something in the column; an empty pass-through directory must not
    // spend any.
    nextFree[depth] = y + (sortedFiles.length > 0 ? pitch.folderGap : 0);
    return y;
  };

  // COMPACT: this folder's files claim its column first, and the
  // subfolders only inherit `startY` as their floor. Nothing waits on
  // anything, so branch heights overlap and the canvas stays short.
  if (!filesBelowSubfolders) {
    let deepest = placeOwnFiles(startY);
    for (const name of sortedChildren) {
      const child = dir.children.get(name);
      if (child) {
        deepest = Math.max(
          deepest,
          placeDirTree(child, depth + 1, startY, positions, pitch, nextFree, false),
        );
      }
    }
    return deepest;
  }

  // FILES PANEL ORDER: subfolders first (never starting above this
  // folder's own start row), then this folder's files below everything
  // they occupied.
  let deepest = startY;
  for (const name of sortedChildren) {
    const child = dir.children.get(name);
    if (child) {
      deepest = Math.max(
        deepest,
        placeDirTree(child, depth + 1, startY, positions, pitch, nextFree, true),
      );
    }
  }
  return placeOwnFiles(Math.max(nextFree[depth] ?? 0, deepest));
}

/**
 * Arrange the loaded set by PATH rather than by edges: column = how
 * deep the node sits, so the root-level nodes read on the left and the
 * deeply nested ones on the right, and each folder's contents sit
 * beside the folder they belong to. Used by the two "Folder" layout
 * options.
 *
 * Why it exists. Dagre ranks nodes by their PREDECESSORS, so a node
 * with no edges lands in rank 0 by definition. Open a corpus with many
 * nodes and few references between them (the common shape of a docs
 * tree that has not been cross-linked yet) and every node shares rank
 * 0: with the default LEFT_RIGHT direction that is one endless vertical
 * column, ordered by nothing the reader can perceive (dagre orders
 * within a rank to minimise edge crossings, and there are no edges to
 * cross). The layout the operator wants there is not a graph layout at
 * all, it is the shape they already have in their head, the folder
 * tree. Edges are ignored outright, which is the point: this answers
 * "where does this file live", not "what does it reference".
 *
 * Column-per-depth alone was not enough (user call): sorting each
 * column independently scattered a folder's children anywhere down the
 * canvas, with nothing tying `docs/deep/*` to where `docs/*` had landed.
 * The layout walks the directory TREE instead.
 *
 * Two variants ship, differing ONLY in where a folder's own files go,
 * because which one reads better depends on the corpus and the operator
 * is the judge:
 *
 *   - `'files-below'` ("Folder (realistic)", the default) matches the files
 *     panel's reading order (`files-view.rows.ts`, `buildTreeRows`):
 *     subfolders first, the folder's own files beneath them, so loose
 *     files sit at the foot of their column. Truest to the panel, and
 *     the tallest.
 *   - `'files-first'` ("Folder (compact)") lets a folder's files sit level
 *     with the folder itself. Much shorter, reads less like a tree.
 *
 * On this repo's 284 markdown nodes: 418 rows against 126.
 *
 * Deterministic (name-sorted at every level, so input order cannot
 * change the result) and cheap: one pass to build the tree, one DFS to
 * place it. Runs synchronously on the same path as the force layout.
 */
export function computeFilesystemLayoutPositions(
  allNodes: INodeView[],
  spacing: IFilesystemSpacingValues,
  variant: 'files-below' | 'files-first',
): Map<string, IPoint> {
  const positions = new Map<string, IPoint>();
  placeDirTree(
    buildDirTree(allNodes),
    0,
    0,
    positions,
    {
      column: NODE_WIDTH + spacing.layerGap,
      row: NODE_HEIGHT + spacing.nodeGap,
      folderGap: spacing.folderGap,
    },
    [],
    variant === 'files-below',
  );
  return positions;
}

/**
 * Single entry point for "give me positions for this set". Owns the
 * dispatch on `preferences.algorithm` so the three callers (the graph
 * view's layout effect, the extracted layout-engine controller, and
 * the camera controller's re-layout of a visible subset) cannot drift
 * apart on which algorithms exist. Every branch is normalised to a
 * promise so callers keep one uniform await chain.
 */
export function computeLayoutPositions(
  engine: DagreLayoutEngine,
  allNodes: INodeView[],
  edges: IGraphEdge[],
  preferences: ILayoutPreferences,
): Promise<Map<string, IPoint>> {
  if (preferences.algorithm === 'force') {
    return Promise.resolve(computeForceLayoutPositions(allNodes, edges));
  }
  if (preferences.algorithm === 'filesystem' || preferences.algorithm === 'filesystem-compact') {
    return Promise.resolve(
      computeFilesystemLayoutPositions(
        allNodes,
        // Its own gap scale, not the dagre one: no edges to route means
        // no clearance to reserve. See `FILESYSTEM_SPACING_VALUES`.
        FILESYSTEM_SPACING_VALUES[preferences.spacing],
        preferences.algorithm === 'filesystem' ? 'files-below' : 'files-first',
      ),
    );
  }
  // Wrapped rather than called bare: dagre's CJS interop can throw on
  // import in some test environments, and the callers handle a rejected
  // promise (keep the previous positions) but not a synchronous throw.
  return Promise.resolve().then(() => computeDagreLayout(engine, allNodes, edges, preferences));
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

