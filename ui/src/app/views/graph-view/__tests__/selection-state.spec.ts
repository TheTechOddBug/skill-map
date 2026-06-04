import { describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { createSelectionState } from '../selection-state';
import type { IGraphData, IGraphEdge, IGraphNode } from '../graph-layout';

function edge(id: string, from: string, to: string): IGraphEdge {
  return { id, from, to, kind: 'references', confidence: 0.6 };
}

function node(id: string): IGraphNode {
  return {
    id,
    path: id,
    view: {} as IGraphNode['view'],
    kind: 'agent',
    position: { x: 0, y: 0 },
    stats: { linksIn: 0, linksOut: 0 },
    summary: {} as IGraphNode['summary'],
  };
}

function makeGraph(): IGraphData {
  // a-b-c, d isolated.
  return {
    nodes: [node('a'), node('b'), node('c'), node('d')],
    edges: [edge('e:ab', 'a', 'b'), edge('e:bc', 'b', 'c')],
  };
}

describe('selection-state', () => {
  it('no selection: every node is unselected, unhighlighted, undimmed', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>(null),
        activeTagSelection: signal<string | null>(null),
      });
      for (const id of ['a', 'b', 'c', 'd']) {
        expect(handle.isSelected(id)).toBe(false);
        expect(handle.isHighlighted(id)).toBe(false);
        expect(handle.isDimmed(id)).toBe(false);
      }
    });
  });

  it('self-selection: selected node is selected, never highlighted or dimmed', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('b'),
        activeTagSelection: signal<string | null>(null),
      });
      expect(handle.isSelected('b')).toBe(true);
      expect(handle.isHighlighted('b')).toBe(false);
      expect(handle.isDimmed('b')).toBe(false);
    });
  });

  it('neighbour: highlighted true, dimmed false', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('b'),
        activeTagSelection: signal<string | null>(null),
      });
      expect(handle.isHighlighted('a')).toBe(true);
      expect(handle.isHighlighted('c')).toBe(true);
      expect(handle.isDimmed('a')).toBe(false);
      expect(handle.isDimmed('c')).toBe(false);
    });
  });

  it('non-neighbour: highlighted false, dimmed true', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('b'),
        activeTagSelection: signal<string | null>(null),
      });
      expect(handle.isHighlighted('d')).toBe(false);
      expect(handle.isDimmed('d')).toBe(true);
    });
  });

  it('tag-selection active: dim is suspended for every node', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('b'),
        activeTagSelection: signal<string | null>('planning'),
      });
      expect(handle.isDimmed('d')).toBe(false);
      expect(handle.isEdgeDimmed(edge('e:ab', 'a', 'b'))).toBe(false);
    });
  });

  it('edge predicates honour selected endpoint', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('a'),
        activeTagSelection: signal<string | null>(null),
      });
      expect(handle.isEdgeHighlighted(edge('e:ab', 'a', 'b'))).toBe(true);
      expect(handle.isEdgeHighlighted(edge('e:bc', 'b', 'c'))).toBe(false);
      expect(handle.isEdgeDimmed(edge('e:ab', 'a', 'b'))).toBe(false);
      expect(handle.isEdgeDimmed(edge('e:bc', 'b', 'c'))).toBe(true);
    });
  });

  it('edgeSelectionView bundles highlight / dim / opacity per edge id', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>('a'),
        activeTagSelection: signal<string | null>(null),
      });
      const view = handle.edgeSelectionView();
      // e:ab touches the selected node 'a': highlighted, not dimmed,
      // opacity from the confidence gradient (0.25 + 0.75 * 0.6 = 0.7).
      expect(view.get('e:ab')).toEqual({ highlighted: true, dimmed: false, opacity: 0.7 });
      // e:bc touches neither endpoint of 'a': dimmed, flat fade opacity.
      expect(view.get('e:bc')).toEqual({ highlighted: false, dimmed: true, opacity: 0.15 });
    });
  });

  it('edgeSelectionView: no selection leaves every edge at its confidence opacity', () => {
    TestBed.runInInjectionContext(() => {
      const handle = createSelectionState({
        graph: signal(makeGraph()),
        selectedNodeId: signal<string | null>(null),
        activeTagSelection: signal<string | null>(null),
      });
      const view = handle.edgeSelectionView();
      for (const id of ['e:ab', 'e:bc']) {
        expect(view.get(id)).toEqual({ highlighted: false, dimmed: false, opacity: 0.7 });
      }
    });
  });
});
