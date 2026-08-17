import { scopedKey } from '../../../../services/scoped-storage';
import { describe, expect, it, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { setupExpansion } from '../expansion.controller';
import type { INodeView } from '../../../../models/node';

function makeNode(path: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name: path, description: '', metadata: { version: '1.0.0' } },
  } as INodeView;
}

describe('expansion.controller', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('setExpanded(id, true) flips state and writes to storage', () => {
    TestBed.runInInjectionContext(() => {
      const handle = setupExpansion({ nodes: signal<readonly INodeView[]>([]) });
      expect(handle.isExpanded('a')).toBe(false);
      handle.setExpanded('a', true);
      expect(handle.isExpanded('a')).toBe(true);
      expect(localStorage.getItem(scopedKey('sm.graph.node-expanded'))).toContain('"a"');
    });
  });

  it('setExpanded(id, false) collapses and persists', () => {
    TestBed.runInInjectionContext(() => {
      const handle = setupExpansion({ nodes: signal<readonly INodeView[]>([]) });
      handle.setExpanded('a', true);
      handle.setExpanded('a', false);
      expect(handle.isExpanded('a')).toBe(false);
    });
  });

  it('no-op when value matches current state (no extra storage write)', () => {
    TestBed.runInInjectionContext(() => {
      const handle = setupExpansion({ nodes: signal<readonly INodeView[]>([]) });
      handle.setExpanded('a', true);
      const before = localStorage.getItem(scopedKey('sm.graph.node-expanded'));
      handle.setExpanded('a', true);
      expect(localStorage.getItem(scopedKey('sm.graph.node-expanded'))).toBe(before);
    });
  });

  it('resetAll() clears every expanded id', () => {
    TestBed.runInInjectionContext(() => {
      const handle = setupExpansion({ nodes: signal<readonly INodeView[]>([]) });
      handle.setExpanded('a', true);
      handle.setExpanded('b', true);
      handle.resetAll();
      expect(handle.isExpanded('a')).toBe(false);
      expect(handle.isExpanded('b')).toBe(false);
    });
  });

  it('reconcile drops ids whose path no longer exists in the loaded set', () => {
    // Seed storage with an expanded id, then load a set that does NOT include it.
    localStorage.setItem(scopedKey('sm.graph.node-expanded'), JSON.stringify(['stale-path.md']));
    const nodes = signal<readonly INodeView[]>([makeNode('agents/a.md')]);

    TestBed.runInInjectionContext(() => {
      const handle = setupExpansion({ nodes });
      // Effect runs after the next CD flush; trigger one.
      TestBed.tick();
      expect(handle.isExpanded('stale-path.md')).toBe(false);
    });
  });

  it('empty loaded set (boot phase) does NOT wipe storage', () => {
    localStorage.setItem(scopedKey('sm.graph.node-expanded'), JSON.stringify(['a']));
    const nodes = signal<readonly INodeView[]>([]);

    TestBed.runInInjectionContext(() => {
      const handle = setupExpansion({ nodes });
      TestBed.tick();
      expect(handle.isExpanded('a')).toBe(true);
    });
  });
});
