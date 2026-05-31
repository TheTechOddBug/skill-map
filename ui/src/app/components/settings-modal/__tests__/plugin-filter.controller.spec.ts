import { beforeEach, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { setupPluginFilter } from '../plugin-filter.controller';
import type { IPluginItemApi } from '../../../../models/api';

/**
 * plugin-filter.controller, owns the search + kind filter signals,
 * the persistence effect for the kind filter, and the derivation
 * pipeline (lock strip → pin sort → kind → search). Tests target the
 * handle directly, mirroring the `setupExpansion` spec style.
 */

function plugin(
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
    ...overrides,
  };
}

function extensionPlugin(
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
        plugin('claude'),
        plugin('gemini'),
      ]);
      const handle = setupPluginFilter({ plugins });
      const ids = handle.filteredPlugins().map((p) => p.id);
      expect(ids).toEqual(['claude', 'gemini']);
      expect(handle.searchActive()).toBe(false);
      expect(handle.kindFilterActive()).toBe(false);
    });
  });

  it('search query hits a plugin id and narrows the list', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([
        plugin('claude'),
        plugin('gemini'),
      ]);
      const handle = setupPluginFilter({ plugins });
      handle.searchText.set('clau');
      const ids = handle.filteredPlugins().map((p) => p.id);
      expect(ids).toEqual(['claude']);
      expect(handle.searchActive()).toBe(true);
    });
  });

  it('kind filter narrows granularity=extension plugins to matching extensions', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([
        extensionPlugin('core', [
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
        extensionPlugin('core', [
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
        plugin('claude'),
        plugin('locked-plugin', { locked: true }),
      ]);
      const handle = setupPluginFilter({ plugins });
      const ids = handle.visiblePlugins().map((p) => p.id);
      expect(ids).toEqual(['claude']);
    });
  });

  it('source filter narrows the list to project (or built-in) plugins', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([
        plugin('core', { source: 'built-in' }),
        plugin('my-plugin', { source: 'project' }),
      ]);
      const handle = setupPluginFilter({ plugins });
      handle.setSourceFilter('project');
      expect(handle.filteredPlugins().map((p) => p.id)).toEqual(['my-plugin']);
      expect(handle.sourceFilterActive()).toBe(true);
      handle.setSourceFilter('built-in');
      expect(handle.filteredPlugins().map((p) => p.id)).toEqual(['core']);
    });
  });

  it('source + kind compose (source first, then kind)', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([
        extensionPlugin('core', [{ id: 'broken-ref', kind: 'analyzer' }]),
        {
          ...extensionPlugin('mine', [
            { id: 'my-analyzer', kind: 'analyzer' },
            { id: 'my-fmt', kind: 'formatter' },
          ]),
          source: 'project',
        },
      ]);
      const handle = setupPluginFilter({ plugins });
      handle.setSourceFilter('project');
      handle.setKindFilter('analyzer');
      const filtered = handle.filteredPlugins();
      expect(filtered.map((p) => p.id)).toEqual(['mine']);
      expect(filtered[0].extensions?.map((e) => e.id)).toEqual(['my-analyzer']);
    });
  });

  it('setSourceFilter persists the choice to localStorage (effect fires on tick)', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([]);
      const handle = setupPluginFilter({ plugins });
      handle.setSourceFilter('project');
      TestBed.tick();
      expect(localStorage.getItem('sm.settings.plugins.source-filter')).toBe('project');
      handle.setSourceFilter('all');
      TestBed.tick();
      expect(localStorage.getItem('sm.settings.plugins.source-filter')).toBeNull();
    });
  });

  it('isSourceFilterActive reflects the current selection', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([]);
      const handle = setupPluginFilter({ plugins });
      expect(handle.isSourceFilterActive('all')).toBe(true);
      expect(handle.isSourceFilterActive('project')).toBe(false);
      handle.setSourceFilter('project');
      expect(handle.isSourceFilterActive('project')).toBe(true);
      expect(handle.isSourceFilterActive('all')).toBe(false);
    });
  });

  it('toggleSourceFilter selects, switches between the two, and toggles off to all', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([]);
      const handle = setupPluginFilter({ plugins });
      handle.toggleSourceFilter('built-in');
      expect(handle.sourceFilter()).toBe('built-in');
      // Switching to the other source replaces it (XOR between the two).
      handle.toggleSourceFilter('project');
      expect(handle.sourceFilter()).toBe('project');
      // Clicking the active one toggles back to 'all'.
      handle.toggleSourceFilter('project');
      expect(handle.sourceFilter()).toBe('all');
    });
  });

  it('toggleKindFilter selects a kind and toggles it back off to all', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([]);
      const handle = setupPluginFilter({ plugins });
      handle.toggleKindFilter('analyzer');
      expect(handle.kindFilter()).toBe('analyzer');
      handle.toggleKindFilter('analyzer');
      expect(handle.kindFilter()).toBe('all');
    });
  });

  it('source and kind axes are independent (toggling one keeps the other)', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([]);
      const handle = setupPluginFilter({ plugins });
      handle.toggleSourceFilter('project');
      handle.toggleKindFilter('analyzer');
      expect(handle.sourceFilter()).toBe('project');
      expect(handle.kindFilter()).toBe('analyzer');
      expect(handle.allFilterActive()).toBe(false);
    });
  });

  it('allFilterActive is true only when both axes are cleared; resetFilters clears both', () => {
    TestBed.runInInjectionContext(() => {
      const plugins = signal<readonly IPluginItemApi[]>([]);
      const handle = setupPluginFilter({ plugins });
      expect(handle.allFilterActive()).toBe(true);
      handle.toggleSourceFilter('built-in');
      handle.toggleKindFilter('formatter');
      expect(handle.allFilterActive()).toBe(false);
      handle.resetFilters();
      expect(handle.sourceFilter()).toBe('all');
      expect(handle.kindFilter()).toBe('all');
      expect(handle.allFilterActive()).toBe(true);
    });
  });
});
