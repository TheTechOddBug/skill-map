/**
 * Left-rail resize state machine for the workspace view. Mirror image of
 * the inspector's `panel-resize.controller.ts`: same rAF-batched drag
 * pattern and `document`-level mouse listeners, but the rail sits on the
 * LEFT edge (handle on its right), so dragging right GROWS it (addition,
 * not subtraction) and the clamp reserves map width instead of panel
 * width.
 *
 * Kept as a `setupX` factory returning a small handle the component
 * captures in its constructor, matching the existing controller style.
 */

import { DestroyRef, computed, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';

export const RAIL_WIDTH_DEFAULT = 440;
const RAIL_WIDTH_MIN = 280;
/** Minimum map area to keep visible at any viewport width. */
const RAIL_VIEWPORT_RESERVE = 480;

export interface IRailResizeConfig {
  destroyRef: DestroyRef;
  /** Initial width (typically read from localStorage). */
  initialWidth: number;
  /** Fired on drag-end with the final width; the host persists it. */
  onCommit: (width: number) => void;
}

export interface IRailResizeHandle {
  /** Effective width after clamping against the live viewport. */
  readonly clampedRailWidth: Signal<number>;
  /** Bound to the right-edge drag handle's `(mousedown)`. */
  readonly onRailResizeStart: (event: MouseEvent) => void;
}

export function setupRailResize(config: IRailResizeConfig): IRailResizeHandle {
  const railWidth = signal<number>(config.initialWidth);
  const viewportWidth = signal<number>(
    typeof window === 'undefined' ? 1920 : window.innerWidth,
  );

  if (typeof window !== 'undefined') {
    fromEvent(window, 'resize')
      .pipe(takeUntilDestroyed(config.destroyRef))
      .subscribe(() => viewportWidth.set(window.innerWidth));
  }

  const maxWidth = (): number =>
    Math.max(RAIL_WIDTH_MIN, viewportWidth() - RAIL_VIEWPORT_RESERVE);

  const clampedRailWidth = computed<number>(() => {
    const max = maxWidth();
    const w = railWidth();
    if (w > max) return Math.min(RAIL_WIDTH_DEFAULT, max);
    if (w < RAIL_WIDTH_MIN) return Math.min(RAIL_WIDTH_DEFAULT, max);
    return w;
  });

  let resizeStart: { mouseX: number; widthAtStart: number } | null = null;
  let pendingWidth: number | null = null;
  let rafHandle: number | null = null;

  const flush = (): void => {
    rafHandle = null;
    if (pendingWidth === null) return;
    railWidth.set(pendingWidth);
    pendingWidth = null;
  };

  const onMove = (event: MouseEvent): void => {
    if (!resizeStart) return;
    // Rail sits on the LEFT edge; the handle is on its right edge.
    // Dragging RIGHT (larger clientX) grows the rail. Hence addition.
    const dx = event.clientX - resizeStart.mouseX;
    const next = resizeStart.widthAtStart + dx;
    const max = maxWidth();
    pendingWidth = Math.min(max, Math.max(RAIL_WIDTH_MIN, next));
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
    if (pendingWidth !== null) {
      railWidth.set(pendingWidth);
      pendingWidth = null;
    }
    config.onCommit(railWidth());
  };

  const onRailResizeStart = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeStart = { mouseX: event.clientX, widthAtStart: clampedRailWidth() };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
  };

  return { clampedRailWidth, onRailResizeStart };
}
