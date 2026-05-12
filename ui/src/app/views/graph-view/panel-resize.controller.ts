/**
 * Inspector-panel resize state machine for the graph view. Owns the
 * `panelWidth` signal (user intent, persisted to storage by the
 * caller), the `viewportWidth` signal (live window width), and the
 * `clampedPanelWidth` computed the template binds.
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * graph + selection + viewport concerns. Mirrors the
 * `inspector-body-state` helper pattern: a `setupX` factory returns
 * a small handle the component captures in its constructor.
 *
 * Mouse handlers attach to `document` on drag start and detach on
 * drag end — the same channel the middle-mouse pan directive uses
 * because Foblex's `fDragHandle` intercepts pointer events on graph
 * nodes, so `mouseup` is the reliable cross-surface signal.
 */

import { DestroyRef, computed, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';

const PANEL_WIDTH_DEFAULT = 400;
const PANEL_WIDTH_MIN = 400;
/** Minimum graph area to keep visible at any viewport width. */
const PANEL_VIEWPORT_RESERVE = 80;

export interface IPanelResizeConfig {
  destroyRef: DestroyRef;
  /** Initial width — typically read from localStorage. */
  initialWidth: number;
  /**
   * Fired on drag-end with the user's final width. The host persists
   * this to storage; the controller does NOT touch storage itself so
   * the persistence policy stays in one place.
   */
  onCommit: (width: number) => void;
}

export interface IPanelResizeHandle {
  /**
   * Effective panel width after clamping against the current
   * viewport. Falls back to the DEFAULT when the user's saved width
   * exceeds the max the viewport allows; the saved intent in
   * `panelWidth` is preserved so a window resize back wider restores
   * the original size.
   */
  readonly clampedPanelWidth: Signal<number>;
  /** Bound to the left-edge drag handle's `(mousedown)`. */
  readonly onPanelResizeStart: (event: MouseEvent) => void;
}

export function setupPanelResize(config: IPanelResizeConfig): IPanelResizeHandle {
  const panelWidth = signal<number>(config.initialWidth);
  const viewportWidth = signal<number>(
    typeof window === 'undefined' ? 1920 : window.innerWidth,
  );

  if (typeof window !== 'undefined') {
    fromEvent(window, 'resize')
      .pipe(takeUntilDestroyed(config.destroyRef))
      .subscribe(() => viewportWidth.set(window.innerWidth));
  }

  const clampedPanelWidth = computed<number>(() => {
    const max = Math.max(PANEL_WIDTH_MIN, viewportWidth() - PANEL_VIEWPORT_RESERVE);
    const w = panelWidth();
    if (w > max) return Math.min(PANEL_WIDTH_DEFAULT, max);
    if (w < PANEL_WIDTH_MIN) return Math.min(PANEL_WIDTH_DEFAULT, max);
    return w;
  });

  let resizeStart: { mouseX: number; widthAtStart: number } | null = null;

  const onMove = (event: MouseEvent): void => {
    if (!resizeStart) return;
    // Panel sits on the right edge of the canvas wrap. Dragging the
    // left handle to the LEFT (smaller clientX) grows the panel; to
    // the RIGHT (larger clientX) shrinks it. Hence subtraction.
    const dx = event.clientX - resizeStart.mouseX;
    const next = resizeStart.widthAtStart - dx;
    const max = Math.max(PANEL_WIDTH_MIN, viewportWidth() - PANEL_VIEWPORT_RESERVE);
    const clamped = Math.min(max, Math.max(PANEL_WIDTH_MIN, next));
    panelWidth.set(clamped);
  };

  const onEnd = (): void => {
    if (!resizeStart) return;
    resizeStart = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
    config.onCommit(panelWidth());
  };

  const onPanelResizeStart = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeStart = { mouseX: event.clientX, widthAtStart: clampedPanelWidth() };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
  };

  return { clampedPanelWidth, onPanelResizeStart };
}
