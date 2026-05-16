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

import { effect, type Signal } from '@angular/core';

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
   * Fit-to-screen wrapper that respects the host's zoom clamp. Foblex's
   * `FitToFlow` ignores `fZoomMaximum` / `fZoomMinimum`, so the host
   * provides its own clamped fit, and this controller calls it instead
   * of going through `canvas.fitToScreen` directly.
   */
  fit: () => void;
}

export interface ILayoutFitHandle {
  /**
   * `true` once the boot fit has settled (or been skipped because of
   * a saved viewport). Consumed as a getter by `viewport-store` to
   * gate `localStorage` writes during the initial fit-to-screen tween.
   */
  readonly hasCompletedInitialLayout: () => boolean;
}

export function setupLayoutFit(config: ILayoutFitConfig): ILayoutFitHandle {
  let hasCompletedInitialLayout = false;
  let lastPathsFingerprint: string | null = null;

  // Initial layout only, fit to screen once when the first batch of
  // nodes arrives. Filter changes do NOT trigger a re-fit: the layout
  // cache keeps unmoved nodes in place, and re-fitting would jump the
  // viewport every time the user toggles a kind. The "Fit to screen"
  // toolbar button is the explicit re-fit affordance.
  effect(() => {
    const visible = config.visibleNodes();
    if (hasCompletedInitialLayout) return;
    if (visible.length === 0) return;
    hasCompletedInitialLayout = true;
    if (!config.savedViewport) config.fit();
  });

  // Auto-fit on add / remove of nodes via WS scan refresh.
  //
  // Filters do NOT trip this, they touch `visibleNodes`, not
  // `loader.nodes()`. Edge-only changes do not trip this either,
  // `pathsFingerprint` excludes edges by design. The first run during
  // boot only seeds `lastPathsFingerprint` (the initial fit is owned
  // by the effect above); subsequent runs fit so the user sees the
  // new layout in full.
  effect(() => {
    const fp = config.pathsFingerprint();
    if (!hasCompletedInitialLayout) {
      lastPathsFingerprint = fp;
      return;
    }
    if (lastPathsFingerprint === fp) return;
    lastPathsFingerprint = fp;
    config.fit();
  });

  return { hasCompletedInitialLayout: () => hasCompletedInitialLayout };
}
