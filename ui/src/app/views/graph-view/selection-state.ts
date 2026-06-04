/**
 * Selection-driven node + edge predicates for the graph view. Owns the
 * adjacency map (derived from the visible graph's edges) and the
 * `is*` helpers the template binds to drive highlight / dim CSS
 * classes after a click. Tag-selection suspension is read off the
 * caller's signal so the multi-select halo wins over per-node dim.
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * graph rendering + node-drag concerns. Mirrors the
 * `inspector-body-state` helper pattern: a `createX` factory returns
 * a small handle the component captures in its constructor.
 */

import { computed, type Signal } from '@angular/core';

import type { IGraphData, IGraphEdge } from './graph-layout';

/**
 * Edge opacity tunables. `DIMMED` paints a flat fade for edges outside
 * the selection halo; active edges run a confidence-weighted gradient
 * `MIN + RANGE * confidence` so high-confidence links read solid and
 * low-confidence ones recede. `CONFIDENCE_DEFAULT` fills in when an
 * edge's `confidence` is missing from the projection. The mapping is
 * intentionally linear: a non-linear curve would amplify any clustering
 * of extractor emissions in the middle of the range.
 */
const EDGE_OPACITY_DIMMED = 0.15;
const EDGE_OPACITY_MIN = 0.25;
const EDGE_OPACITY_RANGE = 0.75;
const EDGE_CONFIDENCE_DEFAULT = 0.6;

export interface ISelectionStateConfig {
  readonly graph: Signal<IGraphData>;
  readonly selectedNodeId: Signal<string | null>;
  /**
   * Truthy while a tag chip is active. The shape is `string | null`
   * today (see `tag-selection.controller.ts`); typed as `unknown`
   * here so the helper stays decoupled from the controller's return
   * shape.
   */
  readonly activeTagSelection: Signal<unknown>;
}

/**
 * Per-node selection state. Three booleans rolled into one record so a
 * Map lookup in the template hands the card host its full selection
 * picture in one shot (instead of N × 3 function calls per CD pass).
 */
export interface ISelectionView {
  readonly selected: boolean;
  readonly highlighted: boolean;
  readonly dimmed: boolean;
}

/**
 * Per-edge selection state. Same shape rationale as `ISelectionView`:
 * one Map lookup hands the `<f-connection>` its full picture per CD
 * pass. `opacity` folds the confidence gradient and the dim override
 * into a single value, so the template binds it directly (inline styles
 * win over the `.f-conn--dimmed` class rule, this is the source of truth).
 */
export interface IEdgeSelectionView {
  readonly highlighted: boolean;
  readonly dimmed: boolean;
  readonly opacity: number;
}

export interface ISelectionStateHandle {
  isSelected(id: string): boolean;
  isHighlighted(id: string): boolean;
  isDimmed(id: string): boolean;
  isEdgeHighlighted(edge: IGraphEdge): boolean;
  isEdgeDimmed(edge: IGraphEdge): boolean;
  /**
   * Pre-computed selection state for every visible node. The map is
   * rebuilt when `graph` / `selectedNodeId` / `activeTagSelection`
   * change; otherwise template reads are O(1). Bound on `<sm-node-card>`
   * via the single `[selection]` input.
   */
  readonly selectionView: Signal<ReadonlyMap<string, ISelectionView>>;
  /**
   * Pre-computed selection state for every visible edge, keyed by
   * `edge.id`. Rebuilt on the same triggers as `selectionView`; template
   * reads are O(1). Bound on each `<f-connection>` through a single
   * `@let` so highlight / dim / opacity cost one lookup per edge, not
   * three function calls per CD pass.
   */
  readonly edgeSelectionView: Signal<ReadonlyMap<string, IEdgeSelectionView>>;
}

export function createSelectionState(
  config: ISelectionStateConfig,
): ISelectionStateHandle {
  /**
   * Adjacency map (undirected): node id → set of node ids it shares an edge with.
   * Used by `is*` helpers to drive highlight / dim classes after a click.
   */
  const adjacency = computed<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of config.graph().edges) {
      if (!map.has(edge.from)) map.set(edge.from, new Set());
      if (!map.has(edge.to)) map.set(edge.to, new Set());
      map.get(edge.from)!.add(edge.to);
      map.get(edge.to)!.add(edge.from);
    }
    return map;
  });

  const isSelected = (id: string): boolean => config.selectedNodeId() === id;

  const isHighlighted = (id: string): boolean => {
    const sel = config.selectedNodeId();
    if (sel === null || sel === id) return false;
    return adjacency().get(sel)?.has(id) ?? false;
  };

  /**
   * Adjacency-driven dim, fades non-neighbours of the selected node
   * to focus the user's reading context. Suspended while a tag
   * selection is active: the multi-select halo (Foblex `.f-selected`)
   * is the dominant visual then, and stacking opacity 0.25 on top of
   * matching nodes made them read "selected but ghosted".
   */
  const isDimmed = (id: string): boolean => {
    if (config.activeTagSelection() !== null) return false;
    const sel = config.selectedNodeId();
    if (sel === null) return false;
    if (sel === id) return false;
    return !(adjacency().get(sel)?.has(id) ?? false);
  };

  const isEdgeHighlighted = (edge: IGraphEdge): boolean => {
    const sel = config.selectedNodeId();
    return sel !== null && (edge.from === sel || edge.to === sel);
  };

  /**
   * Edge dim mirrors `isDimmed`, suspended while a tag selection is
   * active so edges between non-tag-matching nodes don't fade
   * underneath the multi-select halo.
   */
  const isEdgeDimmed = (edge: IGraphEdge): boolean => {
    if (config.activeTagSelection() !== null) return false;
    const sel = config.selectedNodeId();
    if (sel === null) return false;
    return edge.from !== sel && edge.to !== sel;
  };

  const selectionView = computed<ReadonlyMap<string, ISelectionView>>(() => {
    const sel = config.selectedNodeId();
    const tagActive = config.activeTagSelection() !== null;
    const neighbours = sel !== null ? adjacency().get(sel) ?? null : null;
    const out = new Map<string, ISelectionView>();
    for (const node of config.graph().nodes) {
      const id = node.id;
      const isSel = sel === id;
      const isHigh = !isSel && sel !== null && (neighbours?.has(id) ?? false);
      const isDim = !tagActive && sel !== null && !isSel && !(neighbours?.has(id) ?? false);
      out.set(id, { selected: isSel, highlighted: isHigh, dimmed: isDim });
    }
    return out;
  });

  const edgeSelectionView = computed<ReadonlyMap<string, IEdgeSelectionView>>(() => {
    const sel = config.selectedNodeId();
    const tagActive = config.activeTagSelection() !== null;
    const out = new Map<string, IEdgeSelectionView>();
    for (const edge of config.graph().edges) {
      const touchesSel = sel !== null && (edge.from === sel || edge.to === sel);
      const dimmed = !tagActive && sel !== null && !touchesSel;
      const confidence =
        typeof edge.confidence === 'number' ? edge.confidence : EDGE_CONFIDENCE_DEFAULT;
      const opacity = dimmed
        ? EDGE_OPACITY_DIMMED
        : EDGE_OPACITY_MIN + EDGE_OPACITY_RANGE * confidence;
      out.set(edge.id, { highlighted: touchesSel, dimmed, opacity });
    }
    return out;
  });

  return {
    isSelected,
    isHighlighted,
    isDimmed,
    isEdgeHighlighted,
    isEdgeDimmed,
    selectionView,
    edgeSelectionView,
  };
}
