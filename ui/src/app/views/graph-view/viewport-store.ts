/**
 * Viewport position + scale store for the graph view. Owns the
 * `viewportPosition` / `viewportScale` signals, exposes the
 * `canZoomIn` / `canZoomOut` computeds, and handles `onCanvasChange`
 * mirroring + persistence to localStorage.
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * selection + filter + node-drag concerns. Mirrors the
 * `inspector-body-state` helper pattern: a `setupX` factory returns
 * a small handle the component captures in its constructor.
 *
 * Why signals (not field constants): Foblex re-evaluates the input
 * bindings on every CD pass; if the bound viewport value drifts from
 * the canvas's internal viewport, Foblex re-applies the bound value
 * to "reconcile" and snaps the canvas back to its boot position.
 * Mirroring `onCanvasChange` into these signals keeps the binding
 * always in sync, so reconciliation is a no-op.
 */

import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type { FCanvasChangeEvent } from '@foblex/flow';

import { writeStoredViewport, type IStoredViewport } from './graph-view.storage';
import type { IPoint } from './graph-layout';

/**
 * Single source of truth for the canvas zoom range. Wired into BOTH
 * the `canZoomIn` / `canZoomOut` computeds below AND the
 * `[fZoomMinimum]` / `[fZoomMaximum]` bindings on `<f-canvas>` (via
 * `graph-view.ts` re-exposing the constants to the template). Keeping
 * them paired avoids the symptom where Foblex clamps internally but
 * the toolbar buttons remain enabled past the clamp, so clicks
 * silently do nothing and read as "max ignored".
 */
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 2;

export { ZOOM_MIN, ZOOM_MAX };

export interface IViewportStoreConfig {
  /**
   * Initial viewport from storage. `null` triggers the auto-fit-on-
   * boot path; a non-null value keeps the canvas where the user left it.
   */
  savedViewport: IStoredViewport | null;
  /**
   * Gate for storage writes. The host flips this to `true` after the
   * initial auto-fit settles so the boot fit-to-screen doesn't
   * overwrite the saved viewport with the post-fit position. While
   * `false`, `onCanvasChange` mirrors the canvas state into the
   * signals but skips the write.
   */
  hasCompletedInitialLayout: () => boolean;
}

export interface IViewportStoreHandle {
  /**
   * Writable signals are exposed so tag-selection / explicit zoom
   * tweens can drive the viewport. Foblex doesn't fire
   * `(fCanvasChange)` for programmatic input updates (only for user
   * gestures), so writes don't bounce back through `onCanvasChange`.
   */
  readonly viewportPosition: WritableSignal<IPoint>;
  readonly viewportScale: WritableSignal<number>;
  readonly canZoomIn: Signal<boolean>;
  readonly canZoomOut: Signal<boolean>;
  /** Bound to `<f-canvas (fCanvasChange)>`. */
  onCanvasChange(event: FCanvasChangeEvent): void;
}

export function setupViewportStore(config: IViewportStoreConfig): IViewportStoreHandle {
  const viewportPosition = signal<IPoint>(
    config.savedViewport
      ? { x: config.savedViewport.x, y: config.savedViewport.y }
      : { x: 0, y: 0 },
  );
  const viewportScale = signal<number>(config.savedViewport?.scale ?? 1);
  const canZoomIn = computed(() => viewportScale() < ZOOM_MAX - 1e-6);
  const canZoomOut = computed(() => viewportScale() > ZOOM_MIN + 1e-6);

  const onCanvasChange = (event: FCanvasChangeEvent): void => {
    // Pan/zoom emits at high frequency. Skip the signal write when the
    // value matches the previous frame so Foblex's reconciliation
    // roundtrip stays a no-op on unchanged emissions (e.g. mid-pinch
    // frames where only one axis moved).
    const prevPos = viewportPosition();
    if (prevPos.x !== event.position.x || prevPos.y !== event.position.y) {
      viewportPosition.set({ x: event.position.x, y: event.position.y });
    }
    if (viewportScale() !== event.scale) {
      viewportScale.set(event.scale);
    }
    if (!config.hasCompletedInitialLayout()) return;
    writeStoredViewport({
      x: event.position.x,
      y: event.position.y,
      scale: event.scale,
    });
  };

  return { viewportPosition, viewportScale, canZoomIn, canZoomOut, onCanvasChange };
}
