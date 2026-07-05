/**
 * Follow-the-Activity camera controller. While the toolbar toggle is
 * on, the camera auto-frames every executing node (plus the live
 * session capsules) and re-frames, animated, whenever that set
 * changes. Preference persisted in `LivePreferencesService`
 * (`sm.live.follow-activity`); the graph view stays the behaviour's
 * home but only wires the config, the state machine lives here
 * (mirrors `setupLayoutFit` / `setupNodeDrag`).
 *
 * Reactivity contract (unchanged from the inlined original):
 *
 *   - The effect tracks the MEMBERSHIP fingerprint (string-valued on
 *     purpose: effects re-fire on VALUE change, so position churn that
 *     re-evaluates the overlay without changing membership never
 *     re-triggers the camera), the dagre tick (a re-layout moves the
 *     targets, re-frame over the fresh coordinates), and the boot-fit
 *     flag (signal-backed: a persisted follow=ON must start framing as
 *     soon as the boot fit settles, even if the active set never
 *     changes again).
 *   - Position resolution runs UNTRACKED so a node drag does not
 *     re-trigger the tween mid-drag.
 *   - No debounce: activity events already coalesce once per frame in
 *     `NodeActivityService`, and the host's shared supersession token
 *     (inside `animateToTransform`) retargets an in-flight tween
 *     smoothly from wherever the camera is.
 *
 * Manual camera gestures (pan / zoom / fit / re-arrange / isolate /
 * deep-link center) hand control back to the operator via `disable()`,
 * log-viewer follow semantics.
 */

import { computed, effect, untracked, type Signal } from '@angular/core';

import type { LivePreferencesService } from '../../../services/live-preferences';
import type { NodeActivityService } from '../../../services/node-activity';
import type { IPoint } from './graph-layout';
import { computeFitTransform, type IViewportTransform } from './viewport-animation';

/** Minimal structural slice of a live session capsule the camera needs. */
export interface IFollowSession {
  readonly id: string;
  readonly position: IPoint;
}

export interface IFollowActivityConfig {
  /** Owner of the persisted follow preference. */
  livePrefs: LivePreferencesService;
  /** Live-activity source: enablement gate + executing node paths. */
  nodeActivity: NodeActivityService;
  /** Paths currently visible on the canvas (facet AND curation). */
  visiblePaths: Signal<ReadonlySet<string>>;
  /** Live session capsules from the spawn overlay. */
  sessions: () => readonly IFollowSession[];
  /** Dagre tick, re-frames after a re-layout moves the targets. */
  layoutComputedAt: Signal<number>;
  /** Boot-fit flag (MUST be signal-backed, see the module doc). */
  bootFitDone: () => boolean;
  /** Canvas wrap element, `null` while unmounted (soft bail). */
  hostElement: () => HTMLElement | null;
  /** Effective node position: user-pinned wins over the dagre output,
   *  like every other camera path. `undefined` while dagre is pending. */
  positionOf: (path: string) => IPoint | undefined;
  /** Width the open inspector panel reserves over the canvas. */
  panelWidth: () => number;
  zoomMin: number;
  /** Host's single animated-camera entry point (shared supersession). */
  animateToTransform: (transform: IViewportTransform) => void;
}

export interface IFollowActivityHandle {
  /** Follow preference, re-exposed for the toolbar toggle. */
  readonly followActivity: Signal<boolean>;
  /** Toolbar toggle handler. */
  toggle(): void;
  /** Manual camera intents switch follow off (no-ops when already off). */
  disable(): void;
}

/**
 * Wire the follow camera. Must be called where `effect()` can be
 * created (a field initializer or constructor of the host component).
 */
export function setupFollowActivity(config: IFollowActivityConfig): IFollowActivityHandle {
  const { livePrefs, nodeActivity } = config;
  const followActivity = livePrefs.followActivityEnabled;

  /**
   * Membership fingerprint of the follow targets: the executing node
   * paths that are actually on the canvas plus the live session-capsule
   * ids. The empty string doubles as the "follow off / nothing to
   * follow" sentinel (decision: when the activity ends, the camera
   * stays where it is).
   */
  const followTargetsFingerprint = computed<string>(() => {
    if (!followActivity() || !nodeActivity.enabled()) return '';
    const visible = config.visiblePaths();
    const paths = [...nodeActivity.activePaths()].filter((p) => visible.has(p)).sort();
    const sessions = config.sessions().map((s) => s.id).sort();
    return [...paths, ...sessions].join('|');
  });

  /**
   * Frame the follow targets: animated fit over the bbox of every
   * executing node plus the live session capsules. A capsule's
   * footprint is 170x44 while the fit math assumes NODE_W x NODE_H
   * (260x120), so the bbox over-covers it by a few px, harmless under
   * the fit's viewport padding. Bails softly when nothing is
   * resolvable yet (dagre pending, host unmounted); the next
   * `layoutComputedAt` tick re-fires the effect.
   */
  const runFollowActivityFit = (): void => {
    const host = config.hostElement();
    if (!host) return;
    const visible = config.visiblePaths();
    const points: IPoint[] = [];
    for (const path of nodeActivity.activePaths()) {
      if (!visible.has(path)) continue;
      const pt = config.positionOf(path);
      if (pt) points.push({ x: pt.x, y: pt.y });
    }
    for (const session of config.sessions()) {
      points.push({ x: session.position.x, y: session.position.y });
    }
    if (points.length === 0) return;
    const transform = computeFitTransform({
      points,
      wrap: { width: host.clientWidth, height: host.clientHeight },
      panelW: config.panelWidth(),
      zoomMin: config.zoomMin,
    });
    if (!transform) return;
    config.animateToTransform(transform);
  };

  effect(() => {
    const fingerprint = followTargetsFingerprint();
    config.layoutComputedAt();
    const bootFitDone = config.bootFitDone();
    if (fingerprint === '' || !bootFitDone) return;
    untracked(() => runFollowActivityFit());
  });

  return {
    followActivity,
    toggle(): void {
      livePrefs.setFollowActivityEnabled(!followActivity());
    },
    disable(): void {
      livePrefs.setFollowActivityEnabled(false);
    },
  };
}
