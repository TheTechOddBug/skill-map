/**
 * Node-drag state machine for the graph view. Owns the pointer-down
 * anchor used to distinguish a click from a drag, plus the position
 * buffer that absorbs Foblex's high-frequency `fNodePositionChange`
 * stream during a drag. Flushes once at mouseup, then persists.
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * graph rendering + selection + filter concerns. Mirrors the
 * `inspector-body-state` helper pattern: a `setupX` factory returns
 * a small handle the component captures in its constructor.
 *
 * Why buffer in a non-signal: writing to `nodePositions` during the
 * drag would invalidate the `graph` computed (which projects
 * positions into the @for) on every move, forcing Angular to
 * reconcile all node + edge bindings 60-120x/sec - pure overhead
 * since Foblex already manages the dragged node's DOM transform
 * internally. We flush the buffer once at pointerup.
 */

import { DestroyRef, type WritableSignal } from '@angular/core';

import type { IPoint, TNodePositions } from './graph-layout';
import { writeStoredNodePositions } from './graph-view.storage';

export interface INodeDragConfig {
  destroyRef: DestroyRef;
  nodePositions: WritableSignal<TNodePositions>;
  /**
   * Fired with the flushed positions once a drag finishes. Default
   * implementation persists to `localStorage`; tests inject their own
   * to avoid the storage dep.
   */
  onCommit?: (positions: TNodePositions) => void;
}

export interface INodeDragHandle {
  onNodePositionChange(id: string, position: IPoint): void;
  onNodePointerDown(event: PointerEvent): void;
  /**
   * True when `event` came from a pointerdown that did NOT move past
   * the click tolerance (4 px). Consumed by `selectNode` so a drag
   * does not also fire a selection.
   */
  isClickWithoutDrag(event: MouseEvent): boolean;
}

export function setupNodeDrag(config: INodeDragConfig): INodeDragHandle {
  const onCommit = config.onCommit ?? writeStoredNodePositions;
  let pointerDownAt: { x: number; y: number } | null = null;
  let nodeDragInProgress = false;
  let dragBuffer: TNodePositions | null = null;

  const onNodeMouseUp = (): void => {
    queueMicrotask(() => {
      if (!nodeDragInProgress) {
        dragBuffer = null;
        return;
      }
      nodeDragInProgress = false;
      if (dragBuffer) {
        config.nodePositions.set(dragBuffer);
        dragBuffer = null;
      }
      onCommit(config.nodePositions());
    });
  };

  const onNodePositionChange = (id: string, position: IPoint): void => {
    if (!dragBuffer) dragBuffer = { ...config.nodePositions() };
    dragBuffer[id] = { x: position.x, y: position.y };
    nodeDragInProgress = true;
  };

  const onNodePointerDown = (event: PointerEvent): void => {
    pointerDownAt = { x: event.clientX, y: event.clientY };
    // Defer localStorage persistence + signal flush to mouseup. Foblex
    // intercepts pointer events via fDragHandle, so listening on
    // `mouseup` (the same channel the existing middle-mouse pan uses
    // successfully on `document`) is the reliable path. `queueMicrotask`
    // inside the handler defers the flush until after any final
    // fNodePositionChange that Foblex may emit synchronously.
    document.addEventListener('mouseup', onNodeMouseUp, { once: true });
  };

  const isClickWithoutDrag = (event: MouseEvent): boolean => {
    const start = pointerDownAt;
    pointerDownAt = null;
    if (!start) return true;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    return Math.hypot(dx, dy) <= 4;
  };

  // Defensive: `{ once: true }` auto-removes the listener after it
  // fires, but if the host destroys mid-drag the listener is still
  // attached. Detach on destroy so it cannot fire after teardown.
  config.destroyRef.onDestroy(() => {
    document.removeEventListener('mouseup', onNodeMouseUp);
  });

  return { onNodePositionChange, onNodePointerDown, isClickWithoutDrag };
}
