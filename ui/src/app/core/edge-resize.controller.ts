/**
 * Shared edge-panel resize state machine. Owns the width signal (user
 * intent, persisted by the caller), the live viewport-width signal,
 * and the clamped computed the template binds. Replaces the two
 * mirror-image copies that used to live in
 * `graph-view/panel-resize.controller.ts` (right-edge inspector) and
 * `workspace-view/workspace-rail-resize.ts` (left-edge rail); the only
 * genuine differences were the width constants and the drag direction,
 * so both hosts now parameterize this factory.
 *
 * Mouse handlers attach to `document` on drag start and detach on drag
 * end, the same channel the middle-mouse pan directive uses because
 * Foblex's `fDragHandle` intercepts pointer events on graph nodes, so
 * `mouseup` is the reliable cross-surface signal.
 *
 * High-frequency `mousemove` values land in a plain field and are
 * copied into the signal at most once per animation frame, so the
 * panel tracks the cursor visually without churning Angular's change
 * detection.
 */

import { DestroyRef, computed, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';

export interface IEdgeResizeConfig {
  destroyRef: DestroyRef;
  /**
   * Which viewport edge the panel hugs. A `left` panel's drag handle
   * sits on its right edge, so dragging RIGHT grows it; a `right`
   * panel's handle sits on its left edge, so dragging LEFT grows it.
   */
  edge: 'left' | 'right';
  /** Width the panel falls back to when the saved width cannot fit. */
  defaultWidth: number;
  minWidth: number;
  /** Minimum width of the opposite area (map / graph) to keep visible. */
  viewportReserve: number;
  /** Initial width (typically read from localStorage). */
  initialWidth: number;
  /**
   * Fired on drag-end with the user's final width. The host persists
   * this to storage; the controller does NOT touch storage itself so
   * the persistence policy stays in one place.
   */
  onCommit: (width: number) => void;
}

export interface IEdgeResizeHandle {
  /**
   * Effective width after clamping against the current viewport. Falls
   * back to `defaultWidth` when the saved width exceeds the max the
   * viewport allows; the saved intent is preserved so a window resize
   * back wider restores the original size.
   */
  readonly clampedWidth: Signal<number>;
  /** Bound to the drag handle's `(mousedown)`. */
  readonly onResizeStart: (event: MouseEvent) => void;
  /**
   * Keyboard resize step (WCAG 2.1.1): grows the panel by `delta`
   * (positive widens, negative narrows), clamped to the same
   * [min, max] window the mouse drag honours, then commits. Bound to
   * the separator's arrow-key handlers. The caller decides the sign so
   * "arrow towards the panel widens" reads naturally per edge.
   */
  readonly stepBy: (delta: number) => void;
  /** Lower bound for `aria-valuemin`. */
  readonly minWidth: number;
  /** Current upper bound (viewport-dependent) for `aria-valuemax`. */
  readonly maxWidth: Signal<number>;
}

export function setupEdgeResize(config: IEdgeResizeConfig): IEdgeResizeHandle {
  const width = signal<number>(config.initialWidth);
  const viewportWidth = signal<number>(
    typeof window === 'undefined' ? 1920 : window.innerWidth,
  );

  if (typeof window !== 'undefined') {
    fromEvent(window, 'resize')
      .pipe(takeUntilDestroyed(config.destroyRef))
      .subscribe(() => viewportWidth.set(window.innerWidth));
  }

  const maxWidth = (): number =>
    Math.max(config.minWidth, viewportWidth() - config.viewportReserve);

  const maxWidthSignal = computed<number>(() => maxWidth());

  const clampedWidth = computed<number>(() => {
    const max = maxWidth();
    const w = width();
    if (w > max) return Math.min(config.defaultWidth, max);
    if (w < config.minWidth) return Math.min(config.defaultWidth, max);
    return w;
  });

  let resizeStart: { mouseX: number; widthAtStart: number } | null = null;
  let pendingWidth: number | null = null;
  let rafHandle: number | null = null;

  const flush = (): void => {
    rafHandle = null;
    if (pendingWidth === null) return;
    width.set(pendingWidth);
    pendingWidth = null;
  };

  const onMove = (event: MouseEvent): void => {
    if (!resizeStart) return;
    const dx = event.clientX - resizeStart.mouseX;
    // The same rightward drag grows a left panel and shrinks a right
    // one (the handle sits on the opposite side), hence the sign flip.
    const next = config.edge === 'left'
      ? resizeStart.widthAtStart + dx
      : resizeStart.widthAtStart - dx;
    pendingWidth = Math.min(maxWidth(), Math.max(config.minWidth, next));
    if (rafHandle === null && typeof window !== 'undefined') {
      rafHandle = window.requestAnimationFrame(flush);
    }
  };

  const onEnd = (): void => {
    if (!resizeStart) return;
    resizeStart = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    if (rafHandle !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    // Final commit: flush any pending mid-drag value, then persist.
    if (pendingWidth !== null) {
      width.set(pendingWidth);
      pendingWidth = null;
    }
    config.onCommit(width());
  };

  const onResizeStart = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeStart = { mouseX: event.clientX, widthAtStart: clampedWidth() };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
  };

  const stepBy = (delta: number): void => {
    const next = Math.min(maxWidth(), Math.max(config.minWidth, clampedWidth() + delta));
    width.set(next);
    config.onCommit(next);
  };

  return { clampedWidth, onResizeStart, stepBy, minWidth: config.minWidth, maxWidth: maxWidthSignal };
}
