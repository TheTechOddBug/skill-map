/**
 * Initial-fit + auto-fit-on-topology-change state machine for the
 * graph view. Owns the `hasCompletedInitialLayout` flag (consumed by
 * `viewport-store` to gate storage writes during the boot fit) and
 * the `lastPathsFingerprint` watermark used to suppress refits when
 * the topology has not actually changed.
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * graph rendering + selection + filter concerns. Mirrors the
 * `inspector-body-state` helper pattern: a `setupX` factory returns
 * a small handle the component captures in its constructor.
 */

import { effect, signal, type Signal } from '@angular/core';

import type { INodeView } from '../../../models/node';
import type { IStoredViewport } from './graph-view.storage';

export interface ILayoutFitConfig {
  visibleNodes: Signal<readonly INodeView[]>;
  pathsFingerprint: Signal<string>;
  /**
   * Whether the boot read recovered a saved viewport. When present,
   * the initial-fit branch skips the fit to honor the user's last
   * pan / zoom.
   */
  savedViewport: IStoredViewport | null;
  /**
   * Snap fit (no tween), used for the initial boot-time fit. Foblex's
   * `FitToFlow` ignores `fZoomMaximum` / `fZoomMinimum`, so the host
   * provides its own clamped fit, and this controller calls it instead
   * of going through `canvas.fitToScreen` directly.
   */
  fit: () => void;
  /**
   * Animated fit, used by the auto-fit-on-topology-change effect when
   * a WebSocket scan refresh adds or removes nodes. The host computes
   * the target via `computeFitTransform` and tweens the viewport signals
   * directly, that path respects the zoom clamp by construction (the
   * helper writes the post-clamp scale) so we get the nice "camera
   * glides to frame the new layout" feel without the Foblex overshoot
   * the snap fit was guarding against. Falls back to `fit` when omitted.
   */
  animatedFit?: () => void;
}

export interface ILayoutFitHandle {
  /**
   * `true` once the boot fit has settled (or been skipped because of
   * a saved viewport). Consumed as a getter by `viewport-store` to
   * gate `localStorage` writes during the initial fit-to-screen tween,
   * and read reactively by the graph view's deep-link center effect so
   * the camera pan waits for the boot fit to fix the zoom first.
   */
  readonly hasCompletedInitialLayout: () => boolean;
}

export function setupLayoutFit(config: ILayoutFitConfig): ILayoutFitHandle {
  // Signal-backed so effects depending on it re-run when the boot fit
  // settles (the deep-link center pan gates on this). The closure flag
  // mirror keeps the synchronous reads inside the two effects below
  // cheap and non-reactive.
  const completed = signal(false);
  let hasCompletedInitialLayout = false;
  let lastPathsFingerprint: string | null = null;

  // Initial layout only, fit to screen once when the first batch of
  // nodes arrives. Filter changes do NOT trigger a re-fit: the layout
  // cache keeps unmoved nodes in place, and re-fitting would jump the
  // viewport every time the user toggles a kind. The "Fit to screen"
  // toolbar button is the explicit re-fit affordance.
  //
  // `queueMicrotask` is load-bearing: it defers the flag flip so the
  // SECOND effect below can seed `lastPathsFingerprint` on its first
  // run. Flipping the flag inline lets the second effect's same-tick
  // first run see `true`, skip the seed branch, and dispatch a
  // redundant fit on boot.
  effect(() => {
    const visible = config.visibleNodes();
    if (hasCompletedInitialLayout) return;
    if (visible.length === 0) return;
    queueMicrotask(() => {
      hasCompletedInitialLayout = true;
      completed.set(true);
      if (!config.savedViewport) config.fit();
    });
  });

  // Auto-fit on add / remove of nodes via WS scan refresh.
  //
  // Filters do NOT trip this, they touch `visibleNodes`, not
  // `loader.nodes()`. Edge-only changes do not trip this either,
  // `pathsFingerprint` excludes edges by design. The first run during
  // boot only seeds `lastPathsFingerprint` (the initial fit is owned
  // by the effect above); subsequent runs fit so the user sees the
  // new layout in full, animated when the host wired the tween path,
  // snap otherwise.
  effect(() => {
    const fp = config.pathsFingerprint();
    if (!hasCompletedInitialLayout) {
      lastPathsFingerprint = fp;
      return;
    }
    if (lastPathsFingerprint === fp) return;
    lastPathsFingerprint = fp;
    (config.animatedFit ?? config.fit)();
  });

  return { hasCompletedInitialLayout: () => completed() };
}
