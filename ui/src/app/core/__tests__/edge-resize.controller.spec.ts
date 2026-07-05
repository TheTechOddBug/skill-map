import { afterEach, describe, expect, it, vi } from 'vitest';
import { DestroyRef } from '@angular/core';

import { setupEdgeResize, type IEdgeResizeConfig, type IEdgeResizeHandle } from '../edge-resize.controller';

const MIN_WIDTH = 100;
const DEFAULT_WIDTH = 200;
const VIEWPORT_RESERVE = 300;

function makeDestroyRef(): DestroyRef {
  return { onDestroy: () => undefined } as unknown as DestroyRef;
}

/** Max width the clamp allows for the spec constants at the live viewport. */
function maxWidth(): number {
  return Math.max(MIN_WIDTH, window.innerWidth - VIEWPORT_RESERVE);
}

/**
 * Manual rAF queue: `onMove` batches signal writes to one per animation
 * frame, so the spec must control exactly when the flush runs.
 */
let rafQueue: FrameRequestCallback[] = [];
const originalRaf = window.requestAnimationFrame;
const originalCaf = window.cancelAnimationFrame;
const originalInnerWidth = window.innerWidth;

function stubRaf(): void {
  rafQueue = [];
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => rafQueue.push(cb);
  window.cancelAnimationFrame = () => undefined;
}

function flushFrame(): void {
  const cbs = rafQueue;
  rafQueue = [];
  for (const cb of cbs) cb(0);
}

function makeHandle(
  overrides: Partial<IEdgeResizeConfig> = {},
): { handle: IEdgeResizeHandle; onCommit: ReturnType<typeof vi.fn> } {
  const onCommit = vi.fn();
  const handle = setupEdgeResize({
    destroyRef: makeDestroyRef(),
    edge: 'left',
    defaultWidth: DEFAULT_WIDTH,
    minWidth: MIN_WIDTH,
    viewportReserve: VIEWPORT_RESERVE,
    initialWidth: DEFAULT_WIDTH,
    onCommit,
    ...overrides,
  });
  return { handle, onCommit };
}

function mouseDown(handle: IEdgeResizeHandle, clientX: number, button = 0): void {
  handle.onResizeStart(new MouseEvent('mousedown', { clientX, button }));
}

function mouseMove(clientX: number): void {
  document.dispatchEvent(new MouseEvent('mousemove', { clientX }));
}

function mouseUp(): void {
  document.dispatchEvent(new MouseEvent('mouseup'));
}

afterEach(() => {
  // A stuck drag would leak document listeners into the next test.
  mouseUp();
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCaf;
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  });
});

describe('edge-resize.controller', () => {
  it('left edge: dragging right grows, batched to one signal write per frame', () => {
    stubRaf();
    const { handle } = makeHandle({ edge: 'left' });

    mouseDown(handle, 500);
    mouseMove(520);
    mouseMove(550);

    // Two moves, one scheduled frame, signal untouched until it runs.
    expect(rafQueue.length).toBe(1);
    expect(handle.clampedWidth()).toBe(DEFAULT_WIDTH);

    flushFrame();
    expect(handle.clampedWidth()).toBe(DEFAULT_WIDTH + 50);
  });

  it('right edge: the same rightward drag shrinks (sign flip)', () => {
    stubRaf();
    const { handle } = makeHandle({ edge: 'right' });

    mouseDown(handle, 500);
    mouseMove(550);
    flushFrame();
    expect(handle.clampedWidth()).toBe(DEFAULT_WIDTH - 50);

    mouseMove(450);
    flushFrame();
    expect(handle.clampedWidth()).toBe(DEFAULT_WIDTH + 50);
  });

  it('clamps mid-drag values to [minWidth, viewport - reserve]', () => {
    stubRaf();
    const { handle } = makeHandle({ edge: 'left' });

    mouseDown(handle, 500);
    mouseMove(500 + 10_000);
    flushFrame();
    expect(handle.clampedWidth()).toBe(maxWidth());

    mouseMove(500 - 10_000);
    flushFrame();
    expect(handle.clampedWidth()).toBe(MIN_WIDTH);
  });

  it('falls back to the default when the saved width cannot fit the viewport', () => {
    const oversized = makeHandle({ initialWidth: maxWidth() + 1000 });
    expect(oversized.handle.clampedWidth()).toBe(Math.min(DEFAULT_WIDTH, maxWidth()));

    const undersized = makeHandle({ initialWidth: MIN_WIDTH - 50 });
    expect(undersized.handle.clampedWidth()).toBe(Math.min(DEFAULT_WIDTH, maxWidth()));
  });

  it('mouseup flushes the pending width, commits once, and detaches the listeners', () => {
    stubRaf();
    const { handle, onCommit } = makeHandle({ edge: 'left' });

    mouseDown(handle, 500);
    mouseMove(560);
    // No frame flush: onEnd must copy the in-flight value itself.
    mouseUp();

    expect(handle.clampedWidth()).toBe(DEFAULT_WIDTH + 60);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(DEFAULT_WIDTH + 60);

    // Listeners are gone: further movement changes nothing.
    mouseMove(900);
    flushFrame();
    expect(handle.clampedWidth()).toBe(DEFAULT_WIDTH + 60);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('ignores non-primary buttons entirely', () => {
    stubRaf();
    const { handle, onCommit } = makeHandle({ edge: 'left' });

    mouseDown(handle, 500, 1);
    mouseMove(600);
    flushFrame();
    mouseUp();

    expect(handle.clampedWidth()).toBe(DEFAULT_WIDTH);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('re-clamps against the live viewport on window resize, preserving the saved intent', () => {
    const { handle } = makeHandle({ initialWidth: DEFAULT_WIDTH + 100 });
    expect(handle.clampedWidth()).toBe(DEFAULT_WIDTH + 100);

    // Shrink the viewport until even the default no longer fits: the
    // clamp bottoms out at minWidth (max collapses to it).
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: MIN_WIDTH + VIEWPORT_RESERVE - 20,
    });
    window.dispatchEvent(new Event('resize'));
    expect(handle.clampedWidth()).toBe(MIN_WIDTH);

    // Growing it back restores the user's saved width, not the default.
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
    window.dispatchEvent(new Event('resize'));
    expect(handle.clampedWidth()).toBe(DEFAULT_WIDTH + 100);
  });
});
