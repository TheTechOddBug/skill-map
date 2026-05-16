import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { setupLayoutFit } from '../layout-fit.controller';
import type { INodeView } from '../../../../models/node';

function makeNode(path: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name: path, description: '', metadata: { version: '1.0.0' } },
  } as INodeView;
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

describe('layout-fit.controller', () => {
  it('empty visibleNodes: no fit, hasCompletedInitialLayout stays false', () => {
    TestBed.runInInjectionContext(() => {
      const fit = vi.fn();
      const visibleNodes = signal<readonly INodeView[]>([]);
      const pathsFingerprint = signal<string>('');
      const handle = setupLayoutFit({
        visibleNodes,
        pathsFingerprint,
        savedViewport: null,
        fit,
      });
      TestBed.tick();
      expect(fit).not.toHaveBeenCalled();
      expect(handle.hasCompletedInitialLayout()).toBe(false);
    });
  });

  it('first non-empty visibleNodes triggers a fit and flips the flag', async () => {
    await TestBed.runInInjectionContext(async () => {
      const fit = vi.fn();
      const visibleNodes = signal<readonly INodeView[]>([]);
      const pathsFingerprint = signal<string>('');
      const handle = setupLayoutFit({
        visibleNodes,
        pathsFingerprint,
        savedViewport: null,
        fit,
      });
      visibleNodes.set([makeNode('a.md')]);
      TestBed.tick();
      await flushMicrotasks();
      expect(fit).toHaveBeenCalledTimes(1);
      expect(handle.hasCompletedInitialLayout()).toBe(true);
    });
  });

  it('savedViewport present: initial fit is SKIPPED, flag still flips', async () => {
    await TestBed.runInInjectionContext(async () => {
      const fit = vi.fn();
      const visibleNodes = signal<readonly INodeView[]>([]);
      const pathsFingerprint = signal<string>('');
      const handle = setupLayoutFit({
        visibleNodes,
        pathsFingerprint,
        savedViewport: { x: 10, y: 20, scale: 1.5 },
        fit,
      });
      visibleNodes.set([makeNode('a.md')]);
      TestBed.tick();
      await flushMicrotasks();
      expect(fit).not.toHaveBeenCalled();
      expect(handle.hasCompletedInitialLayout()).toBe(true);
    });
  });

  it('same fingerprint after initial fit does NOT re-fit', async () => {
    await TestBed.runInInjectionContext(async () => {
      const fit = vi.fn();
      const visibleNodes = signal<readonly INodeView[]>([makeNode('a.md')]);
      const pathsFingerprint = signal<string>('a.md');
      setupLayoutFit({
        visibleNodes,
        pathsFingerprint,
        savedViewport: null,
        fit,
      });
      TestBed.tick();
      await flushMicrotasks();
      fit.mockClear();

      pathsFingerprint.set('a.md');
      TestBed.tick();
      await flushMicrotasks();
      expect(fit).not.toHaveBeenCalled();
    });
  });

  it('new fingerprint after initial fit triggers a fit', async () => {
    await TestBed.runInInjectionContext(async () => {
      const fit = vi.fn();
      const visibleNodes = signal<readonly INodeView[]>([makeNode('a.md')]);
      const pathsFingerprint = signal<string>('a.md');
      setupLayoutFit({
        visibleNodes,
        pathsFingerprint,
        savedViewport: null,
        fit,
      });
      TestBed.tick();
      await flushMicrotasks();
      fit.mockClear();

      pathsFingerprint.set('a.md|b.md');
      TestBed.tick();
      await flushMicrotasks();
      expect(fit).toHaveBeenCalledTimes(1);
    });
  });
});
