import { describe, expect, it } from 'vitest';

import { reconcileNodePositions } from '../graph-view.reconcile';
import type { IFullLayout } from '../graph-layout';
import type { INodeView } from '../../../../models/node';

function makeNode(path: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name: path, description: '', metadata: { version: '1.0.0' } },
  } as INodeView;
}

function makeLayout(positions: Record<string, { x: number; y: number }>): IFullLayout {
  const map = new Map<string, { x: number; y: number }>();
  for (const [k, v] of Object.entries(positions)) map.set(k, v);
  return {
    nodesByPath: new Map(),
    apiNodesByPath: new Map(),
    edges: [],
    positions: map,
    computedAt: 0,
  };
}

describe('reconcileNodePositions', () => {
  it('no changes: returns clean (dirty=false), allows the host effect to bail without writing', () => {
    const result = reconcileNodePositions({
      nodes: [makeNode('a.md'), makeNode('b.md')],
      current: { 'a.md': { x: 10, y: 20 }, 'b.md': { x: 30, y: 40 } },
      layout: makeLayout({ 'a.md': { x: 10, y: 20 }, 'b.md': { x: 30, y: 40 } }),
    });
    expect(result.dirty).toBe(false);
  });

  it('drops positions for nodes that no longer exist (dirty=true)', () => {
    const result = reconcileNodePositions({
      nodes: [makeNode('a.md')],
      current: { 'a.md': { x: 10, y: 20 }, 'gone.md': { x: 99, y: 99 } },
      layout: makeLayout({ 'a.md': { x: 10, y: 20 } }),
    });
    expect(result.dirty).toBe(true);
    expect(result.next).toEqual({ 'a.md': { x: 10, y: 20 } });
  });

  it('pins newly-loaded nodes against layout positions (dirty=true)', () => {
    const result = reconcileNodePositions({
      nodes: [makeNode('a.md'), makeNode('new.md')],
      current: { 'a.md': { x: 10, y: 20 } },
      layout: makeLayout({ 'a.md': { x: 10, y: 20 }, 'new.md': { x: 55, y: 66 } }),
    });
    expect(result.dirty).toBe(true);
    expect(result.next).toEqual({
      'a.md': { x: 10, y: 20 },
      'new.md': { x: 55, y: 66 },
    });
  });

  // Regression: see commit message. Pre-fix the helper set `dirty = true`
  // whenever `missing.length > 0`, even when `layout.positions` had not
  // yet learned about the missing ids (typical mid-flight during a WS
  // rename: `loader.nodes()` updates instantly, dagre runs async). The
  // host effect would then write `{ ...current }` (same content, new
  // reference), the signal write re-fired the effect, and the loop pegged
  // CPU at 100%+ until dagre finally emitted.
  it('missing paths with no matching layout entry: returns dirty=false (no rewrite loop)', () => {
    const result = reconcileNodePositions({
      nodes: [makeNode('a.md'), makeNode('rename-target.md')],
      current: { 'a.md': { x: 10, y: 20 } },
      // Layout is stale: dagre has not run for `rename-target.md` yet.
      layout: makeLayout({ 'a.md': { x: 10, y: 20 } }),
    });
    expect(result.dirty).toBe(false);
  });

  it('partial layout: applies the entries it has, ignores the rest (dirty=true on real change)', () => {
    const result = reconcileNodePositions({
      nodes: [makeNode('a.md'), makeNode('known.md'), makeNode('unknown.md')],
      current: { 'a.md': { x: 10, y: 20 } },
      layout: makeLayout({ 'a.md': { x: 10, y: 20 }, 'known.md': { x: 77, y: 88 } }),
    });
    expect(result.dirty).toBe(true);
    expect(result.next).toEqual({
      'a.md': { x: 10, y: 20 },
      'known.md': { x: 77, y: 88 },
    });
    expect('unknown.md' in result.next).toBe(false);
  });
});
