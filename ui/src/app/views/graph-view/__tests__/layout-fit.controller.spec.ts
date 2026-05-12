import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FCanvasComponent } from '@foblex/flow';

import { setupLayoutFit } from '../layout-fit.controller';
import type { INodeView } from '../../../../models/node';

function makeNode(path: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name: path, description: '', metadata: { version: '1.0.0' } },
  } as INodeView;
}

interface IFakeCanvas {
  fitToScreen: ReturnType<typeof vi.fn>;
}

function makeFakeCanvas(): IFakeCanvas {
  return { fitToScreen: vi.fn() };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

describe('layout-fit.controller', () => {
  it('empty visibleNodes: no fit, hasCompletedInitialLayout stays false', async () => {
    TestBed.runInInjectionContext(() => {
      const canvas = makeFakeCanvas();
      const visibleNodes = signal<readonly INodeView[]>([]);
      const pathsFingerprint = signal<string>('');
      const handle = setupLayoutFit({
        visibleNodes,
        pathsFingerprint,
        canvas: () => canvas as unknown as FCanvasComponent,
        savedViewport: null,
      });
      TestBed.tick();
      expect(canvas.fitToScreen).not.toHaveBeenCalled();
      expect(handle.hasCompletedInitialLayout()).toBe(false);
    });
  });

  it('first non-empty visibleNodes triggers a non-animated fit and flips the flag', async () => {
    await TestBed.runInInjectionContext(async () => {
      const canvas = makeFakeCanvas();
      const visibleNodes = signal<readonly INodeView[]>([]);
      const pathsFingerprint = signal<string>('');
      const handle = setupLayoutFit({
        visibleNodes,
        pathsFingerprint,
        canvas: () => canvas as unknown as FCanvasComponent,
        savedViewport: null,
      });
      visibleNodes.set([makeNode('a.md')]);
      TestBed.tick();
      await flushMicrotasks();
      expect(canvas.fitToScreen).toHaveBeenCalledTimes(1);
      expect(canvas.fitToScreen).toHaveBeenCalledWith({ x: 40, y: 40 }, false);
      expect(handle.hasCompletedInitialLayout()).toBe(true);
    });
  });

  it('savedViewport present: initial fit is SKIPPED, flag still flips', async () => {
    await TestBed.runInInjectionContext(async () => {
      const canvas = makeFakeCanvas();
      const visibleNodes = signal<readonly INodeView[]>([]);
      const pathsFingerprint = signal<string>('');
      const handle = setupLayoutFit({
        visibleNodes,
        pathsFingerprint,
        canvas: () => canvas as unknown as FCanvasComponent,
        savedViewport: { x: 10, y: 20, scale: 1.5 },
      });
      visibleNodes.set([makeNode('a.md')]);
      TestBed.tick();
      await flushMicrotasks();
      expect(canvas.fitToScreen).not.toHaveBeenCalled();
      expect(handle.hasCompletedInitialLayout()).toBe(true);
    });
  });

  it('same fingerprint after initial fit does NOT re-fit', async () => {
    await TestBed.runInInjectionContext(async () => {
      const canvas = makeFakeCanvas();
      const visibleNodes = signal<readonly INodeView[]>([makeNode('a.md')]);
      const pathsFingerprint = signal<string>('a.md');
      setupLayoutFit({
        visibleNodes,
        pathsFingerprint,
        canvas: () => canvas as unknown as FCanvasComponent,
        savedViewport: null,
      });
      // Trigger initial fit.
      TestBed.tick();
      await flushMicrotasks();
      canvas.fitToScreen.mockClear();

      // Re-emit same fingerprint - no refit.
      pathsFingerprint.set('a.md');
      TestBed.tick();
      await flushMicrotasks();
      expect(canvas.fitToScreen).not.toHaveBeenCalled();
    });
  });

  it('new fingerprint after initial fit triggers an animated fit', async () => {
    await TestBed.runInInjectionContext(async () => {
      const canvas = makeFakeCanvas();
      const visibleNodes = signal<readonly INodeView[]>([makeNode('a.md')]);
      const pathsFingerprint = signal<string>('a.md');
      setupLayoutFit({
        visibleNodes,
        pathsFingerprint,
        canvas: () => canvas as unknown as FCanvasComponent,
        savedViewport: null,
      });
      TestBed.tick();
      await flushMicrotasks();
      canvas.fitToScreen.mockClear();

      pathsFingerprint.set('a.md|b.md');
      TestBed.tick();
      await flushMicrotasks();
      expect(canvas.fitToScreen).toHaveBeenCalledTimes(1);
      expect(canvas.fitToScreen).toHaveBeenCalledWith({ x: 40, y: 40 }, true);
    });
  });
});
