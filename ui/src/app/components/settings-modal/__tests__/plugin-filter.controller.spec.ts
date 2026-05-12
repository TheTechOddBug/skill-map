import { beforeEach, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { setupPluginFilter } from '../plugin-filter.controller';
import type { IPluginItemApi } from '../../../../models/api';

/**
 * plugin-filter.controller — owns the search + kind filter signals,
 * the persistence effect for the kind filter, and the derivation
 * pipeline (lock strip → pin sort → kind → search). Tests target the
 * handle directly, mirroring the `setupExpansion` spec style.
 */

function bundle(
  id: string,
  overrides: Partial<IPluginItemApi> = {},
): IPluginItemApi {
  return {
    id,
    version: '1.0.0',
    kinds: ['provider'],
    status: 'enabled',
    reason: null,
    source: 'built-in',
    granularity: 'bundle',
    ...overrides,
  };
}

function extensionBundle(
  id: string,
  exts: Array<{ id: string; kind: string; description?: string }>,
): IPluginItemApi {
  return {
    id,
    version: null,
    kinds: Array.from(new Set(exts.map((e) => e.kind))),
    status: 'enabled',
    reason: null,
    source: 'built-in',
    granularity: 'extension',
    extensions: exts.map((e) => ({
      id: e.id,
      kind: e.kind,
      version: '1.0.0',
      enabled: true,
      ...(e.description ? { description: e.description } : {}),
    })),
  };
}

describe('plugin-filter.controller', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('empty search + kind=all returns every visible plugin', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([
        bundle('claude'),
        bundle('gemini'),
      ]);
      const handle = setupPluginFilter({ plugins });
      const ids = handle.filteredPlugins().map((p) => p.id);
      expect(ids).toEqual(['claude', 'gemini']);
      expect(handle.searchActive()).toBe(false);
      expect(handle.kindFilterActive()).toBe(false);
    });
  });

  it('search query hits a bundle id and narrows the list', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([
        bundle('claude'),
        bundle('gemini'),
      ]);
      const handle = setupPluginFilter({ plugins });
      handle.searchText.set('clau');
      const ids = handle.filteredPlugins().map((p) => p.id);
      expect(ids).toEqual(['claude']);
      expect(handle.searchActive()).toBe(true);
    });
  });

  it('kind filter narrows granularity=extension bundles to matching extensions', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([
        extensionBundle('core', [
          { id: 'broken-ref', kind: 'analyzer' },
          { id: 'pretty', kind: 'formatter' },
        ]),
      ]);
      const handle = setupPluginFilter({ plugins });
      handle.setKindFilter('analyzer');
      const filtered = handle.filteredPlugins();
      expect(filtered.length).toBe(1);
      expect(filtered[0].extensions?.map((e) => e.id)).toEqual(['broken-ref']);
    });
  });

  it('kind + search compose (kind first, then search)', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([
        extensionBundle('core', [
          { id: 'broken-ref', kind: 'analyzer', description: 'flags missing targets' },
          { id: 'superseded', kind: 'analyzer', description: 'flags supersededBy' },
          { id: 'pretty', kind: 'formatter' },
        ]),
      ]);
      const handle = setupPluginFilter({ plugins });
      handle.setKindFilter('analyzer');
      handle.searchText.set('superseded');
      const filtered = handle.filteredPlugins();
      expect(filtered.length).toBe(1);
      expect(filtered[0].extensions?.map((e) => e.id)).toEqual(['superseded']);
    });
  });

  it('setKindFilter persists the choice to localStorage (effect fires on tick)', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([]);
      const handle = setupPluginFilter({ plugins });
      handle.setKindFilter('analyzer');
      TestBed.tick();
      expect(localStorage.getItem('sm.settings.plugins.kind-filter')).toBe('analyzer');
      handle.setKindFilter('all');
      TestBed.tick();
      expect(localStorage.getItem('sm.settings.plugins.kind-filter')).toBeNull();
    });
  });

  it('isKindFilterActive reflects the current selection', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([]);
      const handle = setupPluginFilter({ plugins });
      expect(handle.isKindFilterActive('all')).toBe(true);
      expect(handle.isKindFilterActive('analyzer')).toBe(false);
      handle.setKindFilter('analyzer');
      expect(handle.isKindFilterActive('analyzer')).toBe(true);
      expect(handle.isKindFilterActive('all')).toBe(false);
    });
  });

  it('visiblePlugins strips host-locked rows before any filter', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([
        bundle('claude'),
        bundle('locked-bundle', { locked: true }),
      ]);
      const handle = setupPluginFilter({ plugins });
      const ids = handle.visiblePlugins().map((p) => p.id);
      expect(ids).toEqual(['claude']);
    });
  });
});
