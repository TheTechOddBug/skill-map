/**
 * Camera controller for the graph view: every fit / center / tween
 * orchestration path lands here. Owns the shared supersession token
 * (each new tween invalidates in-flight ones), the tween timing fields
 * behind the gesture-interrupt detection, the deferred auto-fit flag,
 * the curation re-fit debounce, and the deep-link center queue, plus
 * the three effects that drive them.
 *
 * Extracted from `graph-view.ts` so the view component focuses on
 * selection + overlay + filter concerns. Mirrors the
 * `setupLayoutFit` / `setupFollowActivity` factory shape: a `setupX`
 * factory returns a handle the component captures.
 *
 * Foblex invariants preserved verbatim from the inlined original:
 *
 *   - EVERY pan goes through the `viewportPosition` / `viewportScale`
 *     signals bound to `[position]` / `[scale]` on `<f-canvas>`.
 *     Foblex 18.6 removed the public `setPosition`, so there is no
 *     imperative pan setter; the tween writes the same signals the
 *     bindings read and Foblex applies the transform on input change.
 *   - `hasCompletedInitialLayout` MUST be signal-backed (it is, see
 *     `layout-fit.controller.ts`): the deep-link center effect gates on
 *     it reactively so the camera pan waits for the boot fit.
 *
 * Creation-order contract: `setupCamera` MUST be called from the
 * component constructor AFTER the reconcile effect is declared. The
 * auto-fit runner below reacts to the same `layoutComputedAt` tick as
 * reconcile, and Angular runs same-tick effects in creation order:
 * reconcile-then-fit guarantees the camera tweens toward the rendered
 * geometry (reconciled `nodePositions`), not the pre-reconcile
 * snapshot.
 */

import {
  afterNextRender,
  effect,
  signal,
  untracked,
  type DestroyRef,
  type Injector,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { EFZoomDirection } from '@foblex/flow';
import type { FCanvasChangeEvent, FCanvasComponent, FZoomDirective } from '@foblex/flow';
import type { DagreLayoutEngine } from '@foblex/flow-dagre-layout';

import type { INodeView } from '../../../models/node';
import type { GraphPreferencesService } from '../../../services/graph-preferences';
import type { TOverrideMap } from '../../../services/map-overrides';
import {
  computeDagreLayout,
  computeForceLayoutPositions,
  type IFullLayout,
  type IPoint,
  type ITopology,
  type TNodePositions,
} from './graph-layout';
import { writeStoredNodePositions, writeStoredViewport } from './graph-view.storage';
import {
  animateViewport,
  computeCenterTransform,
  computeFitTransform,
  TAG_FIT_MAX_ZOOM,
  type IViewportTransform,
} from './viewport-animation';

/** Tween duration (ms) for the auto-fit on WS-scan topology change. A
 *  hair longer than the tag-selection tween (320 ms) so the "scan
 *  brought in new nodes, camera glides to frame them" beat reads as a
 *  distinct event without dragging the UX. */
const AUTO_FIT_ANIM_MS = 420;

export interface ICameraConfig {
  /** Host injector for the `afterNextRender` calls (clamp, deferred fits). */
  injector: Injector;
  destroyRef: DestroyRef;
  /** Foblex surfaces, resolved lazily (viewChildren settle after render). */
  canvas: () => FCanvasComponent | undefined;
  zoom: () => FZoomDirective | undefined;
  /** Canvas wrap element, `null` while unmounted (soft bail). */
  canvasWrap: () => HTMLElement | null;
  /**
   * Viewport signals bound to `[position]` / `[scale]` on `<f-canvas>`,
   * the ONLY pan path (see the module doc). The tween writes them
   * directly; Foblex never fires `fCanvasChange` for programmatic
   * input updates, so writes don't bounce back through the store.
   */
  viewportPosition: WritableSignal<IPoint>;
  viewportScale: WritableSignal<number>;
  /** Viewport store's `onCanvasChange` (mirroring + persistence). */
  storeOnCanvasChange: (event: FCanvasChangeEvent) => void;
  zoomMin: number;
  /** Loaded node views, for the visible-subset relayout. */
  nodes: Signal<INodeView[]>;
  topology: Signal<ITopology>;
  fullLayout: Signal<IFullLayout>;
  mapVisiblePaths: Signal<Set<string>>;
  /** Dagre tick; the deferred fits re-fire on it (see each effect). */
  layoutComputedAt: Signal<number>;
  /** User-pinned drag positions; effective position resolution + reset. */
  nodePositions: WritableSignal<TNodePositions>;
  /** Width the open inspector panel reserves over the canvas. */
  reservedPanelWidth: () => number;
  /** Boot-fit flag (MUST be signal-backed, see the module doc). */
  hasCompletedInitialLayout: () => boolean;
  /** Layout preferences, for the visible-subset relayout. */
  graphPreferences: Pick<
    GraphPreferencesService,
    'layoutAlgorithm' | 'layoutDirection' | 'layoutSpacing'
  >;
  dagreLayout: DagreLayoutEngine;
  /** Follow-the-activity coupling: framing state + the gesture disable. */
  framing: () => boolean;
  disableFollow: () => void;
  /** Collapses every expanded card on reset layout. */
  resetExpansion: () => void;
  /** Map-visibility curation, drives the debounced re-fit effect. */
  curationOverrides: Signal<TOverrideMap>;
  /** Active tag selection; a tag-driven curation change skips the re-fit. */
  activeTagSelection: Signal<string | null>;
}

export interface ICameraHandle {
  /** Bound (via the host) to `<f-canvas (fCanvasChange)>`. */
  onCanvasChange(event: FCanvasChangeEvent): void;
  /** Snap fit respecting the zoom clamp (boot fit + prefs-change fit). */
  fitToScreenClamped(): void;
  /** Deferred animated fit, wired into `setupLayoutFit`'s `animatedFit`. */
  animatedFitToScreen(): void;
  /** Animated fit over the on-screen nodes (toolbar fit, reset, curation). */
  runAnimatedFit(): void;
  /** Single tween entry point (shared supersession token). */
  animateToTransform(transform: IViewportTransform): void;
  /** Reset-layout executor (the confirm dialog stays in the host). */
  applyResetLayout(visiblePaths: Set<string>, full: boolean): void;
  /** Pixel centre of the canvas wrap, the zoom buttons' pivot. */
  getViewportCenter(): { x: number; y: number };
  /**
   * Node id (== node path) queued by a deep-link selection (the files
   * view "open in map" navigation). The center effect below drains it
   * once the boot fit and dagre positions are ready. Signal-backed so a
   * repeated deep-link re-fires the effect: in the fused workspace the
   * graph stays mounted, so clicking a second file would set this
   * without changing `layoutComputedAt` / `hasCompletedInitialLayout`,
   * and a plain field would leave the effect dormant (camera never
   * re-centers). As a signal, each set invalidates the effect and the
   * camera glides to the new node.
   */
  readonly pendingCenterNodeId: WritableSignal<string | null>;
}

/**
 * Wire the camera. Must be called where `effect()` can be created (the
 * host component's constructor), respecting the creation-order contract
 * in the module doc (after the reconcile effect).
 */
export function setupCamera(config: ICameraConfig): ICameraHandle {
  /** Supersession token for the auto-fit tween, increments on each
   *  call so a back-to-back WS scan refresh cancels the in-flight tween
   *  cleanly (mirrors the tag-selection pattern). */
  let autoFitAnimToken = 0;

  /**
   * Wall-clock start of the last animated camera tween. A tween runs
   * exactly `AUTO_FIT_ANIM_MS` from here (a superseding call restarts
   * the window together with the tween), so "started less than a
   * duration ago" IS the in-flight state, no completion callback
   * needed. `-Infinity` so the pre-first-tween window never reads as
   * moving (`performance.now()` starts near 0 at page load).
   */
  let cameraTweenStartedAt = Number.NEGATIVE_INFINITY;

  /** True while an animated camera move (fit / center / follow) is in flight. */
  const cameraTweenInFlight = (): boolean =>
    performance.now() - cameraTweenStartedAt < AUTO_FIT_ANIM_MS;

  /**
   * Set to `true` when `setupLayoutFit` fires its animated callback on
   * a topology change; the actual tween is deferred to the next
   * `layoutComputedAt` tick (see the auto-fit runner effect below).
   * The deferral is load-bearing: `pathsFingerprint` changes BEFORE
   * dagre re-layouts, so reading `layoutPositions` during the callback
   * would tween toward a stale bbox, the symptom the user reported
   * was deletes anchoring on the pre-delete positions.
   */
  let autoFitPending = false;

  /**
   * Debounce timer for the re-fit on a map-visibility change. A folder
   * cascade is one signal tick (one fit), but rapid single-leaf toggles
   * each tick the curation effect; coalescing them into one camera glide
   * keeps the viewport from thrashing. Cleared on destroy.
   */
  let mapFitDebounce: ReturnType<typeof setTimeout> | null = null;

  /** See `ICameraHandle.pendingCenterNodeId`. */
  const pendingCenterNodeId = signal<string | null>(null);

  const getViewportCenter = (): { x: number; y: number } => {
    const host = config.canvasWrap();
    if (!host) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  };

  /**
   * Canvas change handler: mirrors the event into the viewport store
   * (reconciliation + persistence) and doubles as the manual-gesture
   * hook for Follow the Activity. Foblex only fires `fCanvasChange`
   * for USER gestures (wheel / pinch / canvas drag / the zoom buttons'
   * `setZoom`) plus the middle-mouse pan's explicit
   * `emitCanvasChangeEvent()` flush, never for programmatic
   * `[position]` / `[scale]` writes, so the follow tween itself cannot
   * trip this and the event IS the "operator touched the camera"
   * signal. Gated on the boot fit: the initial imperative
   * `fitToScreenClamped` (Foblex `fitToScreen` + `setZoom` clamp)
   * emits too, and must not kill a persisted follow preference at
   * startup.
   *
   * Follow drops ONLY when the gesture interrupts a camera move in
   * flight: the operator grabbed the wheel while the camera was
   * driving itself, so the tween is cancelled on the spot (its rAF
   * loop would keep writing over the user's hand for the rest of its
   * 420ms) and the preference switches off. A gesture while the
   * camera RESTS keeps follow armed, panning around between
   * executions is free and the next membership change re-frames.
   * The toolbar's camera / layout buttons (zoom / fit / re-arrange)
   * keep follow armed; only isolate and the deep-link center still
   * disable at their call sites.
   */
  const onCanvasChange = (event: FCanvasChangeEvent): void => {
    config.storeOnCanvasChange(event);
    if (!config.hasCompletedInitialLayout()) return;
    if (!cameraTweenInFlight()) return;
    autoFitAnimToken++;
    config.disableFollow();
  };

  /**
   * Run a fit that respects `zoomMin` / `zoomMax`. Foblex's `FitToFlow`
   * writes `transform.scale` directly without clamping (verified in
   * `node_modules/@foblex/flow/fesm2022/foblex-flow.mjs`, `FitToFlow.handle`),
   * so a sparse graph balloons past the user's max. We delegate the fit
   * itself to Foblex (it owns the bbox + parent rect math) but follow
   * it up with our own clamp inside the SAME render cycle via
   * `afterNextRender`: Foblex's `_afterRedraw` already uses
   * `afterNextRender`, so by queueing right after we land in the same
   * `rAF` tick, Foblex's fit runs first, our clamp runs second, and the
   * browser only paints the post-clamp frame. Non-animated fit is used
   * so the (briefly held) pre-clamp transform never hits a CSS
   * transition that would expose the overshoot to the eye.
   */
  const fitToScreenClamped = (): void => {
    const canvas = config.canvas();
    const zoom = config.zoom();
    if (!canvas) return;
    canvas.fitToScreen({ x: 40, y: 40 }, false);
    afterNextRender(
      () => {
        const scale = canvas.transform.scale;
        // Clamp the fit to the fit-to-content ceiling (`TAG_FIT_MAX_ZOOM`),
        // NOT the wheel-zoom max (`zoomMax`): Foblex's `fitToScreen`
        // ignores the zoom bounds and magnifies a lone node far past
        // natural size, so a one-node project would otherwise open
        // gigantic. Zoom-out (many nodes) is bounded by `zoomMin`.
        if (scale > TAG_FIT_MAX_ZOOM || scale < config.zoomMin) {
          const clamped = Math.max(config.zoomMin, Math.min(scale, TAG_FIT_MAX_ZOOM));
          const step = Math.abs(scale - clamped);
          const direction = scale > clamped ? EFZoomDirection.ZOOM_OUT : EFZoomDirection.ZOOM_IN;
          // `FZoomDirective.setZoom` clamps via `SetZoom._clamp` (the same
          // path wheel + button zoom go through), so it lands exactly at
          // `zoomMin` / `zoomMax`. Non-animated to keep the snap atomic
          // inside this render cycle.
          zoom?.setZoom(getViewportCenter(), step, direction, false);
        }
        // Persist the settled fit. Foblex's `fitToScreen` (FitToFlow)
        // never emits `fCanvasChange`, so a layout-algorithm / direction
        // change would otherwise be lost on F5 like the animated fits
        // were. Read the transform AFTER the optional clamp so the saved
        // scale matches what is painted; the clamp's `setZoom` also emits
        // and would write the same value, so this is idempotent there.
        if (config.hasCompletedInitialLayout()) {
          const t = canvas.transform;
          writeStoredViewport({ x: t.position.x, y: t.position.y, scale: t.scale });
        }
      },
      { injector: config.injector },
    );
  };

  /** Public-facing scheduler the layout-fit controller wires into
   *  `animatedFit`. Just marks intent; the deferred runner does the work. */
  const animatedFitToScreen = (): void => {
    autoFitPending = true;
  };

  /**
   * Glide the viewport toward `transform` with the shared supersession
   * token. Single tween entry point for every animated camera move
   * (auto-fit, deep-link center, follow-the-activity), so back-to-back
   * moves from different features cancel each other cleanly instead of
   * fighting over the viewport signals.
   */
  const animateToTransform = (transform: IViewportTransform): void => {
    const token = ++autoFitAnimToken;
    cameraTweenStartedAt = performance.now();
    animateViewport(
      {
        readPosition: () => config.viewportPosition(),
        readScale: () => config.viewportScale(),
        writePosition: (p) => config.viewportPosition.set(p),
        writeScale: (s) => config.viewportScale.set(s),
        isStaleToken: () => token !== autoFitAnimToken,
      },
      transform,
      AUTO_FIT_ANIM_MS,
    );
    // Persist the destination so a reload restores where the camera was
    // parked. Foblex only emits `fCanvasChange` (the other writer of
    // `sm.graph.viewport`) for real gestures and button zoom, never for
    // the programmatic signal writes `animateViewport` makes, so without
    // this every fit / re-arrange / show-all / isolate / deep-link
    // center / follow move was lost on F5. Write the TARGET (already the
    // clamped final transform) directly rather than through
    // `emitCanvasChangeEvent()`, which would trip the tween-interrupt
    // branch in `onCanvasChange` and wrongly disable follow. The boot
    // gate mirrors `viewport-store`: don't clobber the restored viewport
    // before the first layout settles.
    if (config.hasCompletedInitialLayout()) {
      writeStoredViewport({ x: transform.position.x, y: transform.position.y, scale: transform.scale });
    }
  };

  /**
   * Compute the pan/zoom that fits the on-screen nodes inside the
   * VISIBLE canvas, reserving the inspector panel's width when it is open
   * so the camera frames the area the operator actually sees (left of
   * the panel). Shared by every camera fit (the auto-fit on scan, the
   * curation re-fit, and the explicit re-arrange / fit buttons) so they
   * all honour the panel identically.
   *
   * Reads EFFECTIVE positions the way `projectVisible` does: user-pinned
   * (`nodePositions`) wins over the dagre output, layout map as fallback,
   * so the bbox matches what is actually rendered after manual drags
   * (reading just the dagre map produced the "zoom expanded too much"
   * symptom). Fits over the SAME set the canvas renders (facet ∩
   * curation). The files rail needs no special handling: it is a flex
   * sibling that already narrows `canvasWrap`, so `clientWidth` excludes
   * it. Returns null when nothing is on screen or the host is unmounted.
   */
  const computeVisibleFitTransform = (): IViewportTransform | null => {
    const host = config.canvasWrap();
    if (!host) return null;
    const layoutPositions = config.fullLayout().positions;
    if (layoutPositions.size === 0) return null;
    const pinned = config.nodePositions();
    const points: IPoint[] = [];
    for (const path of config.mapVisiblePaths()) {
      const pt = pinned.get(path) ?? layoutPositions.get(path);
      if (pt) points.push({ x: pt.x, y: pt.y });
    }
    if (points.length === 0) return null;
    return computeFitTransform({
      points,
      wrap: { width: host.clientWidth, height: host.clientHeight },
      panelW: config.reservedPanelWidth(),
      zoomMin: config.zoomMin,
    });
  };

  /**
   * Run the animated fit: the camera glides (pan + zoom) to frame the
   * on-screen nodes. Drives both the deferred auto-fit (scan add / remove,
   * curation re-fit) and the explicit re-arrange / fit buttons, so every
   * fit in the view animates the same way. Pure signal tween via
   * `viewport-animation`: the clamp lives inside `computeFitTransform`
   * (returns the scale already clamped to `[zoomMin, TAG_FIT_MAX_ZOOM]`),
   * so we get the camera-glide UX without Foblex's `FitToFlow`
   * overshoot the snap-then-clamp path `fitToScreenClamped` is
   * specifically guarding against.
   *
   * Empty-points / no-wrap guards mirror tag-selection; the visible-
   * paths intersection ensures filter-hidden nodes don't anchor the
   * bbox (a filter that hides everything but one node should fit on
   * that one node when the WS scan brings in a sibling).
   */
  const runAnimatedFit = (): void => {
    const transform = computeVisibleFitTransform();
    if (!transform) return;
    animateToTransform(transform);
  };

  /**
   * Pan the camera so a single node sits in the centre of the visible
   * canvas (left of the inspector panel), WITHOUT changing zoom. Driven
   * by the files-view deep link, not by in-map clicks. Reuses the
   * `autoFitAnimToken` so a competing auto-fit / center supersedes this
   * tween cleanly. The effective position mirrors `projectVisible` /
   * `runAnimatedFit`: user-pinned drag position wins over the dagre
   * output. Bails when the node is not currently visible on the map, has
   * no resolvable position, or the host isn't mounted.
   */
  const centerOnNode = (nodeId: string): void => {
    // A deep-link center is an explicit "look at THIS node" intent, the
    // camera is the operator's again: follow-the-activity yields.
    config.disableFollow();
    // Only pan to a node that is actually on the map. When it is curated /
    // filtered out of the visible set there is nothing on screen to center
    // on (its full-layout position points at empty space), so leave the
    // camera where it is.
    if (!config.mapVisiblePaths().has(nodeId)) return;
    const host = config.canvasWrap();
    if (!host) return;
    const pt = config.nodePositions().get(nodeId) ?? config.fullLayout().positions.get(nodeId);
    if (!pt) return;

    const transform = computeCenterTransform({
      point: pt,
      wrap: { width: host.clientWidth, height: host.clientHeight },
      panelW: config.reservedPanelWidth(),
      scale: config.viewportScale(),
    });
    animateToTransform(transform);
  };

  /**
   * Re-run the layout engine over ONLY the visible nodes and the edges
   * between them, then pin the result (`manual: true`) so the reconcile
   * pass, which reseeds AUTO pins from the FULL-graph dagre output, leaves
   * it verbatim. Hidden nodes keep their stored coordinates, so showing
   * them again later yields a hybrid layout that a full "show all" reset
   * re-tidies.
   */
  const relayoutVisibleSubset = async (visiblePaths: Set<string>): Promise<void> => {
    const subNodes = config.nodes().filter((n) => visiblePaths.has(n.path));
    if (subNodes.length === 0) return;
    const subEdges = config.topology().edges.filter(
      (e) => visiblePaths.has(e.from) && visiblePaths.has(e.to),
    );
    const preferences = {
      algorithm: config.graphPreferences.layoutAlgorithm(),
      direction: config.graphPreferences.layoutDirection(),
      spacing: config.graphPreferences.layoutSpacing(),
    };
    const positions = await Promise.resolve(
      preferences.algorithm === 'force'
        ? computeForceLayoutPositions(subNodes, subEdges)
        : computeDagreLayout(config.dagreLayout, subNodes, subEdges, preferences),
    );
    const next: TNodePositions = new Map(config.nodePositions());
    for (const [path, pt] of positions) {
      next.set(path, { x: pt.x, y: pt.y, manual: true });
    }
    config.nodePositions.set(next);
    writeStoredNodePositions(next);
  };

  const applyResetLayout = (visiblePaths: Set<string>, full: boolean): void => {
    // Reset keeps follow armed, like every toolbar button. When follow is
    // framing a live target, the re-layout tick re-fires its camera
    // effect, so the fit-all below (`runAnimatedFit`) would only fight
    // it: skip the fit and let follow frame the active set. With follow
    // off / idle, fit the fresh layout as before.
    const framing = config.framing();
    // Reset also collapses every expanded card: the intent is "give me a
    // clean canvas", and leaving cards open re-introduces the size
    // variation that made the user reach for reset in the first place.
    config.resetExpansion();
    if (full) {
      // Clearing `nodePositions` is the only mechanical step needed: the
      // reconcile effect runs on the next tick, sees an empty map plus the
      // current full-graph auto-layout, reseeds every node, and persists.
      // That's the original delete → re-arrange → save loop.
      config.nodePositions.set(new Map());
      if (!framing) runAnimatedFit();
      return;
    }
    void relayoutVisibleSubset(visiblePaths)
      .then(() => {
        if (!framing) runAnimatedFit();
      })
      .catch(() => {
        // Layout failure (e.g. dagre CJS interop missing in tests) must
        // not crash the view; the previous positions stay.
      });
  };

  // Auto-fit animation runner. `setupLayoutFit` fires `animatedFit`
  // on the `pathsFingerprint` change tick, which lands BEFORE the
  // async dagre layout finishes. We can't read `fullLayout()` at that
  // moment, the positions are still the pre-change snapshot, so a
  // deletion tweens toward the bbox of the surviving nodes' OLD
  // positions and lands wrong once dagre relayouts. Deferring to the
  // next `layoutComputedAt` tick guarantees fresh positions are in
  // place before `runAnimatedFit` reads them, AND the reconcile
  // effect (declared in the host constructor BEFORE this controller)
  // has already mirrored those positions into `nodePositions` (the
  // source `runAnimatedFit` actually consults for the bbox, mirroring
  // `projectVisible`).
  effect(() => {
    config.layoutComputedAt();
    if (!autoFitPending) return;
    autoFitPending = false;
    runAnimatedFit();
  });

  // Deep-link center pan. A files-view "open in map" navigation stashes
  // the target node id in `pendingCenterNodeId`; this effect runs the
  // camera glide once BOTH gates are satisfied: the boot fit has fixed
  // the zoom (`hasCompletedInitialLayout`, signal-backed so this
  // re-fires when it flips) AND dagre has produced positions (the
  // `layoutComputedAt` tick). The pan itself is deferred to
  // `afterNextRender` so Foblex's snap fit + clamp have already
  // applied and the scale `centerOnNode` reads is the settled one,
  // the pan keeps that zoom and only moves the position.
  effect(() => {
    config.layoutComputedAt();
    const bootFitDone = config.hasCompletedInitialLayout();
    const id = pendingCenterNodeId();
    if (id === null || !bootFitDone) return;
    if (config.fullLayout().positions.size === 0) return;
    pendingCenterNodeId.set(null);
    afterNextRender(() => centerOnNode(id), { injector: config.injector });
  });

  // Re-fit the camera when the map visibility curation changes (decision:
  // refit on every change) UNLESS that change rode in on a tag selection.
  // A tag click curates in place (hides the non-matching cards) but
  // deliberately leaves the camera where it is: the operator clicked a
  // tag on a card they were already looking at, and a pan / zoom jump
  // reads as the view running away from them. The genuine curation
  // gestures (rail checkboxes, isolate) still glide. We tell the two
  // apart by the `activeTagSelection` transition: when it changed since
  // the last run (tag activated, swapped, or toggled off) the paths moved
  // because of the tag and we skip the refit; when it held steady the
  // paths moved for a non-tag reason and we frame the result. Debounced
  // so a burst of checkbox toggles coalesces into one glide. Topology is
  // unchanged on a pure visibility edit, so `layoutComputedAt` does NOT
  // tick; positions are already settled post-boot, so we drive
  // `runAnimatedFit` via `afterNextRender` directly (which lets
  // `projectVisible` render the new node set first).
  let lastTagForRefit: string | null = null;
  effect(() => {
    config.curationOverrides(); // refit on curation change ...
    const tag = config.activeTagSelection(); // ... but not when a tag drove it
    const tagChanged = tag !== lastTagForRefit;
    lastTagForRefit = tag;
    if (tagChanged) {
      // Tag selection curates in place and never reframes. It also
      // cancels any refit a just-prior curation gesture queued, so the
      // camera stays put across the tag click.
      if (mapFitDebounce !== null) clearTimeout(mapFitDebounce);
      mapFitDebounce = null;
      return;
    }
    // Gate, NOT a dependency: reading it tracked would also refit on the
    // boot flip of this flag (a redundant re-frame). `untracked` keeps the
    // effect firing only when the curation set actually changes.
    if (!untracked(() => config.hasCompletedInitialLayout())) return;
    if (mapFitDebounce !== null) clearTimeout(mapFitDebounce);
    mapFitDebounce = setTimeout(() => {
      afterNextRender(() => runAnimatedFit(), { injector: config.injector });
    }, 180);
  });
  config.destroyRef.onDestroy(() => {
    if (mapFitDebounce !== null) clearTimeout(mapFitDebounce);
  });

  return {
    onCanvasChange,
    fitToScreenClamped,
    animatedFitToScreen,
    runAnimatedFit,
    animateToTransform,
    applyResetLayout,
    getViewportCenter,
    pendingCenterNodeId,
  };
}
