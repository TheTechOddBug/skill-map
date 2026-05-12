/**
 * Viewport animation + fit-transform helpers for the graph view.
 *
 * Two pure-ish primitives extracted out of `graph-view.ts` so the
 * component is left orchestrating signals while the math (bbox fit,
 * cubic ease-out tween) lives in a unit-testable surface.
 *
 *   - `computeFitTransform` — given a set of node positions and the
 *     wrap dimensions, returns the `{ position, scale }` that centers
 *     the bbox inside the visible canvas with comfortable padding.
 *     Pure. No DOM, no signals.
 *
 *   - `animateViewport` — drives a cubic ease-out tween from the
 *     current viewport (read via the supplied callbacks) toward a
 *     target, calling `writePosition` / `writeScale` on each frame.
 *     The caller owns the abort token so back-to-back animations
 *     cancel each other cleanly.
 */

import type { IPoint } from './graph-layout';

/** Approximated node card dimensions used by the fit-bbox math. */
const NODE_W = 260;
const NODE_H = 120;
/** Padding (px) from the visible canvas edge to the bbox after fit. */
const VIEWPORT_PAD = 80;
/** Soft cap on tag-fit zoom. Lower than `ZOOM_MAX` so a single-match
 *  tag doesn't catapult one card to fill the entire screen. */
const TAG_FIT_MAX_ZOOM = 2;

export interface IWrapDims {
  width: number;
  height: number;
}

export interface IViewportTransform {
  position: IPoint;
  scale: number;
}

export interface IFitTransformInput {
  points: readonly IPoint[];
  wrap: IWrapDims;
  /** Width of the inspector panel overlay (0 when closed). */
  panelW: number;
  /** Lower zoom clamp; the caller's `ZOOM_MIN`. */
  zoomMin: number;
}

/**
 * Compute the pan / zoom that fits `points` (the top-left corners of
 * node cards) inside the visible portion of the canvas wrap, leaving
 * `VIEWPORT_PAD` around the bbox and reserving the inspector panel's
 * width on the right edge. Returns `null` when there's nothing to fit
 * or the wrap has no usable space.
 */
export function computeFitTransform(input: IFitTransformInput): IViewportTransform | null {
  const { points, wrap, panelW, zoomMin } = input;
  if (points.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x + NODE_W > maxX) maxX = pt.x + NODE_W;
    if (pt.y + NODE_H > maxY) maxY = pt.y + NODE_H;
  }

  // Inspector panel overlays the right edge — subtract its width so
  // the matching bbox doesn't land underneath it.
  const visibleW = Math.max(1, wrap.width - panelW);
  const bboxW = Math.max(1, maxX - minX);
  const bboxH = Math.max(1, maxY - minY);
  const availW = Math.max(1, visibleW - VIEWPORT_PAD * 2);
  const availH = Math.max(1, wrap.height - VIEWPORT_PAD * 2);

  const fitScale = Math.min(availW / bboxW, availH / bboxH);
  const scale = Math.min(TAG_FIT_MAX_ZOOM, Math.max(zoomMin, fitScale));

  const bboxCx = (minX + maxX) / 2;
  const bboxCy = (minY + maxY) / 2;
  // Center the bbox horizontally in the VISIBLE half of the canvas
  // (left of the panel), not in the geometric centre of the wrap.
  const targetX = visibleW / 2 - bboxCx * scale;
  const targetY = wrap.height / 2 - bboxCy * scale;

  return { position: { x: targetX, y: targetY }, scale };
}

export interface IAnimateViewportIO {
  readPosition: () => IPoint;
  readScale: () => number;
  writePosition: (p: IPoint) => void;
  writeScale: (s: number) => void;
  /** Monotonically increasing token. Stale frames bail when the value
   *  changes underneath them. The caller increments this BEFORE
   *  calling `animateViewport` and the helper reads the same value to
   *  detect supersession. */
  isStaleToken: () => boolean;
}

/**
 * Tween the viewport (position + scale) toward `target` over
 * `durationMs` with cubic ease-out. Each frame reads `isStaleToken()`
 * and aborts when a newer call superseded this animation — keeps
 * back-to-back tag clicks from fighting over the signals.
 *
 * When `requestAnimationFrame` is unavailable (SSR / tests) or the
 * duration is non-positive, jumps straight to the target.
 */
export function animateViewport(
  io: IAnimateViewportIO,
  target: IViewportTransform,
  durationMs: number,
): void {
  if (typeof requestAnimationFrame === 'undefined' || durationMs <= 0) {
    io.writePosition(target.position);
    io.writeScale(target.scale);
    return;
  }
  const startPos = io.readPosition();
  const startScale = io.readScale();
  const t0 = performance.now();
  const step = (now: number): void => {
    if (io.isStaleToken()) return;
    const t = Math.min(1, (now - t0) / durationMs);
    const e = easeOutCubic(t);
    io.writePosition({
      x: startPos.x + (target.position.x - startPos.x) * e,
      y: startPos.y + (target.position.y - startPos.y) * e,
    });
    io.writeScale(startScale + (target.scale - startScale) * e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
