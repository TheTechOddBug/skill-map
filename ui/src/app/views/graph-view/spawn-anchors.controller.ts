/**
 * Live-overlay controller for the graph view: the ephemeral spawn
 * overlay (dashed spawn edges, floating session anchors, agent
 * capsules), the transient tool-invocation edges, the per-pair
 * conversation counters, the edge click routing, and the conversation
 * dialog wiring. Everything here is page-lifetime by contract; nothing
 * reaches `fullLayout`, the reconciler, persisted positions, or the
 * fit bbox.
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * selection + camera + filter concerns. Mirrors the
 * `setupFollowActivity` / `setupNodeDrag` factory shape: a `setupX`
 * factory returns a handle the component captures in a field
 * initializer. Pure computeds + closures, no injection context needed.
 *
 * Drag-end contract (Foblex skill rule 9): `fDragHandle` consumes
 * `pointerup`, so BOTH drag-end listeners below register `mouseup` on
 * `document`, exactly like the node-drag controller and the middle-
 * mouse pan.
 */

import { computed, signal, type DestroyRef, type Signal } from '@angular/core';

import type { ISpawnThread } from '../../components/conversation-dialog/spawn-thread';
import { setupConversationDialog } from '../../components/conversation-dialog/conversation-dialog.controller';
import type { IDataSourcePort } from '../../../services/data-source/data-source.port';
import type { AgentSpawnService } from '../../../services/agent-spawn';
import type { LivePreferencesService } from '../../../services/live-preferences';
import type { NodeActivityService } from '../../../services/node-activity';
import type { NodeActivityStatsService } from '../../../services/node-activity-stats';
import type {
  IFullLayout,
  IGraphData,
  IGraphEdge,
  IPoint,
  TNodePositions,
} from './graph-layout';
import {
  EMPTY_SPAWN_OVERLAY,
  edgePairKey,
  resolveSpawnOverlay,
  type ISpawnOverlay,
} from './spawn-overlay';
import {
  EMPTY_INVOCATION_EDGES,
  resolveInvocationOverlay,
  type IInvocationOverlayEdge,
} from './invocation-overlay';

export interface ISpawnAnchorsConfig {
  /** Detaches the in-flight drag-end `mouseup` listeners on teardown. */
  destroyRef: DestroyRef;
  /** Live spawn state (dashed edges + session anchors). */
  agentSpawns: Pick<AgentSpawnService, 'spawnEdges' | 'sessionNodes'>;
  /** Tool-invocation stream feeding the transient labeled edges. */
  nodeActivity: Pick<NodeActivityService, 'activeInvocations'>;
  /** Per-pair spawn counters feeding the conversation-count labels. */
  activityStats: Pick<NodeActivityStatsService, 'pairCounts'>;
  /** Runtime-agent visibility preference for the capsules. */
  livePrefs: Pick<LivePreferencesService, 'showRuntimeAgents'>;
  /** BFF port for the conversation dialog's on-demand fetches. */
  dataSource: IDataSourcePort;
  /** User-pinned drag positions (effective-position resolution). */
  nodePositions: Signal<TNodePositions>;
  fullLayout: Signal<IFullLayout>;
  mapVisiblePaths: Signal<Set<string>>;
  /** Rendered graph, source of the static pairs the overlay dedupes on. */
  graph: Signal<IGraphData>;
  /**
   * Spawn-id lookup the static-edge click router consults. Routed
   * THROUGH the host's `spawnActiveIdFor` method (which delegates back
   * to this handle's pure lookup) so an instance-level override on the
   * component, the way the component spec pins the lookup, still
   * intercepts the click routing.
   */
  resolveSpawnActiveId: (edge: IGraphEdge) => string | null;
}

export interface ISpawnAnchorsHandle {
  readonly spawnOverlay: Signal<ISpawnOverlay>;
  readonly invocationEdges: Signal<readonly IInvocationOverlayEdge[]>;
  /** Conversation dialog state, re-exposed for the template bindings. */
  readonly conversationOpen: Signal<boolean>;
  readonly conversationThread: Signal<ISpawnThread | null>;
  readonly conversationCaptureEnabled: Signal<boolean>;
  /** The spawn riding this static edge, or `null` when the edge is plain. */
  spawnActiveIdFor(edge: IGraphEdge): string | null;
  convoCountFor(edge: IGraphEdge): number;
  convoCountForKey(pairKey: string): number;
  onSessionPointerDown(owner: string): void;
  onSessionPositionChange(owner: string, position: IPoint): void;
  onAgentCapsulePointerDown(id: string): void;
  onAgentCapsulePositionChange(id: string, position: IPoint): void;
  onStaticEdgeClick(edge: IGraphEdge, event: MouseEvent): void;
  onSpawnEdgeClick(spawnId: string, event: MouseEvent): void;
  onConversationClosed(): void;
}

export function setupSpawnAnchors(config: ISpawnAnchorsConfig): ISpawnAnchorsHandle {
  /**
   * Session-anchor and agent-capsule drags write the reported position
   * back into their EPHEMERAL override map ON EVERY MOVE, deliberately
   * diverging from the card pattern's buffer-and-flush (skill rule 9).
   * Reason: these anchors' `[fNodePosition]` binds a DERIVED value
   * (children centroid / instructions affinity / capsule row) that
   * `spawnOverlay` recomputes whenever a live activity frame lands,
   * and agents are running by definition while anchors exist. Foblex
   * reconciles the input on every CD pass, so a mid-drag recompute
   * would snap the grabbed anchor back to its derived spot; writing
   * the reported position back per move keeps the bound value in sync
   * and turns that reconcile into a no-op (the same write-back contract
   * as the persisted-viewport `[position]` binding). Rule 9's costs do
   * not apply here: the write only invalidates the cheap `spawnOverlay`
   * computed (a handful of anchors, never the graph @for), and there is
   * no sync I/O (overrides are page-lifetime by contract, never the
   * persisted node-position store).
   *
   * The `dragging*` flags gate the writes to an actual grab
   * (pointerdown -> mouseup, `fDragHandle` consumes `pointerup`): a
   * position event outside a drag must never pin the anchor, or the
   * derived float would silently stop following its inputs.
   */
  let draggingSessionOwner: string | null = null;

  /**
   * User-dragged session-anchor positions, keyed by session owner.
   * Ephemeral by contract (page lifetime, never persisted); survives a
   * session's decay so a reappearing session lands where the user left
   * it. Written only by the drag-end flush above.
   */
  const sessionPositionOverrides = signal<ReadonlyMap<string, IPoint>>(new Map());

  const onSessionMouseUp = (): void => {
    // One microtask so a final synchronous fNodePositionChange around
    // the up event still passes the gate before it closes.
    queueMicrotask(() => {
      draggingSessionOwner = null;
    });
  };

  const onSessionPointerDown = (owner: string): void => {
    draggingSessionOwner = owner;
    document.addEventListener('mouseup', onSessionMouseUp, { once: true });
  };

  const onSessionPositionChange = (owner: string, position: IPoint): void => {
    if (draggingSessionOwner !== owner) return;
    const next = new Map(sessionPositionOverrides());
    next.set(owner, { x: position.x, y: position.y });
    sessionPositionOverrides.set(next);
  };

  /** Agent-capsule drag, the exact session-anchor pattern, keyed by capsule id. */
  let draggingCapsuleId: string | null = null;

  /**
   * User-dragged agent-capsule positions, keyed by the synthetic
   * capsule id. Same ephemeral contract as the session overrides.
   */
  const agentPositionOverrides = signal<ReadonlyMap<string, IPoint>>(new Map());

  const onAgentCapsuleMouseUp = (): void => {
    queueMicrotask(() => {
      draggingCapsuleId = null;
    });
  };

  const onAgentCapsulePointerDown = (id: string): void => {
    draggingCapsuleId = id;
    document.addEventListener('mouseup', onAgentCapsuleMouseUp, { once: true });
  };

  const onAgentCapsulePositionChange = (id: string, position: IPoint): void => {
    if (draggingCapsuleId !== id) return;
    const next = new Map(agentPositionOverrides());
    next.set(id, { x: position.x, y: position.y });
    agentPositionOverrides.set(next);
  };

  /**
   * Ephemeral spawn overlay (spec/provider-activity.md §WS event:
   * `agent.spawn`), LAYERED BESIDE `graph()`: dashed spawn edges plus
   * floating session anchors, projected against the SAME visible set
   * and effective positions the canvas renders, but through a separate
   * computed so the synthetic `session:<owner>` ids never reach
   * `fullLayout`, the reconciler, persisted positions, or the fit
   * bbox. Empty (and dependency-cheap) while nothing is spawning.
   */
  const spawnOverlay = computed<ISpawnOverlay>(() => {
    const spawns = config.agentSpawns.spawnEdges();
    if (spawns.length === 0) return EMPTY_SPAWN_OVERLAY;
    const pinned = config.nodePositions();
    const layout = config.fullLayout().positions;
    const sessionOverrides = sessionPositionOverrides();
    const agentOverrides = agentPositionOverrides();
    // RENDERED static pairs (edge-kind filters + visibility already
    // applied by `graph()`): a spawn whose exact pair is drawn rides
    // that static edge instead of duplicating it; a pair the user
    // filtered out keeps the standalone dashed edge.
    const staticPairs = new Set(config.graph().edges.map((e) => edgePairKey(e.from, e.to)));
    return resolveSpawnOverlay({
      spawns,
      sessions: config.agentSpawns.sessionNodes(),
      visiblePaths: config.mapVisiblePaths(),
      staticPairs,
      positionOf: (path) => pinned.get(path) ?? layout.get(path),
      sessionPositionOf: (owner) => sessionOverrides.get(owner),
      agentPositionOf: (id) => agentOverrides.get(id),
      showAgents: config.livePrefs.showRuntimeAgents(),
    });
  });

  /**
   * pairKey -> representative spawnId for static edges hosting live
   * spawn state. Any spawn of the pair works, the click opens the
   * whole THREAD via the two-fetch widening; emission order makes the
   * last (most recent) spawn win.
   */
  const spawnActiveByPair = computed<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    for (const entry of spawnOverlay().activeOnStatic) {
      map.set(entry.pairKey, entry.spawnId);
    }
    return map;
  });

  /** The spawn riding this static edge, or `null` when the edge is plain. */
  const spawnActiveIdFor = (edge: IGraphEdge): string | null =>
    spawnActiveByPair().get(edgePairKey(edge.from, edge.to)) ?? null;

  /**
   * Transient tool-invocation edges (spec/provider-activity.md §WS
   * event: node.activity, the `detail` field): caller -> mcp target,
   * the invoked tool as the label. Projected from the correlated
   * `NodeActivityService.activeInvocations`, filtered to the pairs whose
   * BOTH endpoints are visible + positioned. Cheap and empty while
   * nothing is invoking.
   */
  const invocationEdges = computed<readonly IInvocationOverlayEdge[]>(() => {
    const invocations = config.nodeActivity.activeInvocations();
    if (invocations.length === 0) return EMPTY_INVOCATION_EDGES;
    const pinned = config.nodePositions();
    const layout = config.fullLayout().positions;
    return resolveInvocationOverlay({
      invocations,
      visiblePaths: config.mapVisiblePaths(),
      positionOf: (path) => pinned.get(path) ?? layout.get(path),
    });
  });

  /**
   * Key-form sibling of `convoCountFor` for the dashed spawn edges,
   * whose pair key is precomputed by `resolveSpawnOverlay` (session
   * parents key by the raw owner, not the `session:<owner>` node id).
   */
  const convoCountForKey = (pairKey: string): number =>
    config.activityStats.pairCounts().get(pairKey) ?? 0;

  /**
   * Conversation count of a static edge's directional pair (spec
   * §Execution stats, per-pair spawn counters). One O(1) Map lookup
   * per edge; feeds the count pill and gates the historical click.
   */
  const convoCountFor = (edge: IGraphEdge): number =>
    convoCountForKey(edgePairKey(edge.from, edge.to));

  /**
   * Conversation dialog (spec §Conversation capture), state machine
   * shared with the inspector via
   * `conversation-dialog.controller.ts` (the inspector's activity rows
   * drive the same dialog through the no-fetch `openThread` path). The
   * graph opens it from edge clicks: a spawn edge fetches the record
   * by id and widens it to the full parent-child thread, a labelled
   * static edge opens the pair's historical thread; scan-link edges
   * stay non-clickable. Supersession between racing clicks lives in
   * the controller.
   */
  const conversation = setupConversationDialog({ dataSource: config.dataSource });

  const onSpawnEdgeClick = (spawnId: string, event: MouseEvent): void => {
    // Keep the click from bubbling to the canvas wrap, which would
    // clear the node selection underneath the dialog.
    event.stopPropagation();
    void conversation.openSpawn(spawnId);
  };

  /**
   * Static-edge click, two live paths plus a no-op:
   *
   *   1. A spawn-active edge (a live spawn rides it) opens through the
   *      SAME path as the dashed spawn edge (supersession guard
   *      included), the live spawnId wins.
   *   2. A plain edge whose pair has counted conversations opens the
   *      HISTORICAL thread: the child's activity detail filtered to
   *      this parent, grouped, most recent thread first.
   *   3. A label-less static edge stays selection-only (no fetch, no
   *      dialog).
   */
  const onStaticEdgeClick = (edge: IGraphEdge, event: MouseEvent): void => {
    const spawnId = config.resolveSpawnActiveId(edge);
    if (spawnId !== null) {
      onSpawnEdgeClick(spawnId, event);
      return;
    }
    if (convoCountFor(edge) === 0) return;
    // Keep the click from bubbling to the canvas wrap (mirrors the
    // spawn-edge handler): it would clear the node selection.
    event.stopPropagation();
    void conversation.openHistorical({
      parentPath: edge.from,
      childPath: edge.to,
      pairKey: edgePairKey(edge.from, edge.to),
    });
  };

  const onConversationClosed = (): void => {
    conversation.close();
  };

  // Defensive: `{ once: true }` auto-removes each listener after it
  // fires, but a host destroyed mid-drag leaves it attached and the
  // callback would run against torn-down state. Detach both on destroy
  // (mirrors `node-drag.controller.ts`).
  config.destroyRef.onDestroy(() => {
    document.removeEventListener('mouseup', onSessionMouseUp);
    document.removeEventListener('mouseup', onAgentCapsuleMouseUp);
  });

  return {
    spawnOverlay,
    invocationEdges,
    conversationOpen: conversation.open,
    conversationThread: conversation.thread,
    conversationCaptureEnabled: conversation.captureEnabled,
    spawnActiveIdFor,
    convoCountFor,
    convoCountForKey,
    onSessionPointerDown,
    onSessionPositionChange,
    onAgentCapsulePointerDown,
    onAgentCapsulePositionChange,
    onStaticEdgeClick,
    onSpawnEdgeClick,
    onConversationClosed,
  };
}
