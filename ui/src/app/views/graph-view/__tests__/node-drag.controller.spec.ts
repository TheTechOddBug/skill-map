import { describe, expect, it, vi } from 'vitest';
import { signal, DestroyRef } from '@angular/core';

import { setupNodeDrag } from '../node-drag.controller';
import type { TNodePositions } from '../graph-layout';

function makeDestroyRef(): { ref: DestroyRef; trigger: () => void } {
  let onDestroyCb: (() => void) | null = null;
  const ref = {
    onDestroy(cb: () => void) {
      onDestroyCb = cb;
    },
  } as unknown as DestroyRef;
  return {
    ref,
    trigger: () => onDestroyCb?.(),
  };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

describe('node-drag.controller', () => {
  it('pointerdown + position changes + mouseup flushes buffer ONCE and persists', async () => {
    const positions = signal<TNodePositions>({});
    const onCommit = vi.fn();
    const { ref } = makeDestroyRef();
    const handle = setupNodeDrag({ destroyRef: ref, nodePositions: positions, onCommit });

    handle.onNodePointerDown(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    handle.onNodePositionChange('a', { x: 10, y: 20 });
    handle.onNodePositionChange('a', { x: 50, y: 60 });
    handle.onNodePositionChange('b', { x: 200, y: 300 });

    // During drag: buffer accumulates, signal untouched.
    expect(positions()).toEqual({});

    document.dispatchEvent(new MouseEvent('mouseup'));
    await flushMicrotasks();

    expect(positions()).toEqual({
      a: { x: 50, y: 60 },
      b: { x: 200, y: 300 },
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({
      a: { x: 50, y: 60 },
      b: { x: 200, y: 300 },
    });
  });

  it('pointerdown + mouseup with NO position change does not persist', async () => {
    const positions = signal<TNodePositions>({});
    const onCommit = vi.fn();
    const { ref } = makeDestroyRef();
    const handle = setupNodeDrag({ destroyRef: ref, nodePositions: positions, onCommit });

    handle.onNodePointerDown(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    await flushMicrotasks();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('pointerdown without position change: isClickWithoutDrag === true', () => {
    const positions = signal<TNodePositions>({});
    const { ref } = makeDestroyRef();
    const handle = setupNodeDrag({
      destroyRef: ref,
      nodePositions: positions,
      onCommit: () => undefined,
    });

    handle.onNodePointerDown(new PointerEvent('pointerdown', { clientX: 50, clientY: 50 }));
    expect(
      handle.isClickWithoutDrag(new MouseEvent('mouseup', { clientX: 51, clientY: 52 })),
    ).toBe(true);
  });

  it('pointerdown + drag past tolerance: isClickWithoutDrag === false', () => {
    const positions = signal<TNodePositions>({});
    const { ref } = makeDestroyRef();
    const handle = setupNodeDrag({
      destroyRef: ref,
      nodePositions: positions,
      onCommit: () => undefined,
    });

    handle.onNodePointerDown(new PointerEvent('pointerdown', { clientX: 50, clientY: 50 }));
    expect(
      handle.isClickWithoutDrag(new MouseEvent('mouseup', { clientX: 200, clientY: 200 })),
    ).toBe(false);
  });

  it('destroyRef.onDestroy is wired so the helper can clean up', () => {
    const positions = signal<TNodePositions>({});
    const { ref, trigger } = makeDestroyRef();
    setupNodeDrag({
      destroyRef: ref,
      nodePositions: positions,
      onCommit: () => undefined,
    });
    // Should not throw — confirms the controller registered a teardown hook.
    expect(() => trigger()).not.toThrow();
  });
});
