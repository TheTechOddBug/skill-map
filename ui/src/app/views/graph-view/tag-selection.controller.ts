/**
 * Tag-selection state machine for the graph view. Owns the
 * `activeTagSelection` signal, the viewport snapshot used to restore
 * the pre-tag pan / zoom on toggle-clear, and the supersession token
 * that keeps back-to-back tag clicks from spawning competing tween
 * loops.
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * graph rendering + node-drag + filter concerns. Mirrors the
 * `inspector-body-state` helper pattern: a `setupX` factory returns
 * a small handle the component captures in its constructor.
 */

import { signal, type Signal, type WritableSignal } from '@angular/core';
import type { FFlowComponent } from '@foblex/flow';

import type { INodeView } from '../../../models/node';
import { nodeHasTag } from './graph-view.utils';
import type { IFullLayout, IPoint } from './graph-layout';
import {
  animateViewport,
  computeFitTransform,
  type IViewportTransform,
} from './viewport-animation';

/** Tween duration (ms) for tag-fit and tag-restore viewport animations. */
const VIEWPORT_ANIM_MS = 320;

export interface ITagSelectionConfig {
  /** Foblex flow handle, used for `select()` / `clearSelection()`. */
  readonly flow: Signal<FFlowComponent | undefined>;
  /** Source for the full node list. */
  readonly nodes: Signal<INodeView[]>;
  /** Full layout (positions + edges), used to compute the fit bbox. */
  readonly fullLayout: Signal<IFullLayout>;
  /** Live canvas wrap dimensions. Returns `null` when the host is not mounted yet. */
  readonly canvasWrap: () => { width: number; height: number } | null;
  /** Selected node id, drives whether the inspector panel reserves space in the fit. */
  readonly selectedNodeId: Signal<string | null>;
  /** Inspector panel width when open. */
  readonly clampedPanelWidth: Signal<number>;
  /** Zoom floor, viewport snapshots must stay above this. */
  readonly zoomMin: number;
  readonly viewportPosition: WritableSignal<IPoint>;
  readonly viewportScale: WritableSignal<number>;
}

export interface ITagSelectionHandle {
  readonly activeTagSelection: Signal<string | null>;
  /**
   * Tag chip click forwarded from the embedded inspector panel.
   * Toggles the multi-select halo via Foblex's native selection API
   * and animates the viewport to fit the matching node bbox.
   */
  onTagSelect: (tag: string) => void;
}

export function setupTagSelection(config: ITagSelectionConfig): ITagSelectionHandle {
  const activeTagSelection = signal<string | null>(null);
  let viewportBeforeTagSelect: { position: IPoint; scale: number } | null = null;
  let viewportAnimToken = 0;

  const animateViewportTo = (target: IViewportTransform, durationMs: number): void => {
    const token = ++viewportAnimToken;
    animateViewport(
      {
        readPosition: () => config.viewportPosition(),
        readScale: () => config.viewportScale(),
        writePosition: (p) => config.viewportPosition.set(p),
        writeScale: (s) => config.viewportScale.set(s),
        isStaleToken: () => token !== viewportAnimToken,
      },
      target,
      durationMs,
    );
  };

  const fitViewportToPaths = (paths: readonly string[]): void => {
    const wrap = config.canvasWrap();
    if (!wrap) return;
    if (paths.length === 0) return;

    const layout = config.fullLayout();
    const points: IPoint[] = [];
    for (const p of paths) {
      const pt = layout.positions.get(p);
      if (pt) points.push(pt);
    }
    if (points.length === 0) return;

    const transform = computeFitTransform({
      points,
      wrap,
      panelW: config.selectedNodeId() !== null ? config.clampedPanelWidth() : 0,
      zoomMin: config.zoomMin,
    });
    if (!transform) return;
    animateViewportTo(transform, VIEWPORT_ANIM_MS);
  };

  const restoreViewportFromTagSnapshot = (): void => {
    const saved = viewportBeforeTagSelect;
    if (!saved) return;
    viewportBeforeTagSelect = null;
    animateViewportTo({ position: saved.position, scale: saved.scale }, VIEWPORT_ANIM_MS);
  };

  const onTagSelect = (tag: string): void => {
    const flow = config.flow();
    if (!flow) return;
    if (activeTagSelection() === tag) {
      flow.clearSelection();
      activeTagSelection.set(null);
      restoreViewportFromTagSnapshot();
      return;
    }
    const paths = config
      .nodes()
      .filter((n) => nodeHasTag(n, tag))
      .map((n) => n.path);
    if (paths.length === 0) {
      flow.clearSelection();
      activeTagSelection.set(null);
      restoreViewportFromTagSnapshot();
      return;
    }
    // Snapshot the viewport on first activation only, swaps don't
    // overwrite, so toggling off after N swaps still lands on the
    // pre-tag pan / zoom the user came from.
    if (viewportBeforeTagSelect === null) {
      viewportBeforeTagSelect = {
        position: { ...config.viewportPosition() },
        scale: config.viewportScale(),
      };
    }
    flow.select(paths, []);
    activeTagSelection.set(tag);
    fitViewportToPaths(paths);
  };

  return { activeTagSelection, onTagSelect };
}
