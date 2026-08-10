import { describe, expect, it } from 'vitest';

import { reconcileNodePositions } from '../graph-view.reconcile';
import type { IFullLayout, IPoint, IStoredNodePosition } from '../graph-layout';
import type { INodeView } from '../../../../models/node';

function asMap(
  record: Record<string, IStoredNodePosition>,
): Map<string, IStoredNodePosition> {
  return new Map(Object.entries(record));
}

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

/**
 * Wrapper defaulting `corpusPaths` to the branch node set, which is the
 * pre-map-views baseline (corpus == loaded branch). Tests exercising the
 * hidden-vs-deleted asymmetry pass their own wider corpus.
 */
function reconcile(input: {
  nodes: Parameters<typeof reconcileNodePositions>[0]['nodes'];
  current: Parameters<typeof reconcileNodePositions>[0]['current'];
  layout: Parameters<typeof reconcileNodePositions>[0]['layout'];
  corpusPaths?: ReadonlySet<string>;
}): ReturnType<typeof reconcileNodePositions> {
  return reconcileNodePositions({
    ...input,
    corpusPaths: input.corpusPaths ?? new Set(input.nodes.map((n) => n.path)),
  });
}

describe('reconcileNodePositions', () => {
  it('no changes: returns clean (dirty=false), allows the host effect to bail without writing', () => {
    const result = reconcile({
      nodes: [makeNode('a.md'), makeNode('b.md')],
      current: asMap({ 'a.md': { x: 10, y: 20 }, 'b.md': { x: 30, y: 40 } }),
      layout: makeLayout({ 'a.md': { x: 10, y: 20 }, 'b.md': { x: 30, y: 40 } }),
    });
    expect(result.dirty).toBe(false);
  });

  it('drops positions for nodes that no longer exist (dirty=true)', () => {
    const result = reconcile({
      nodes: [makeNode('a.md')],
      current: asMap({ 'a.md': { x: 10, y: 20 }, 'gone.md': { x: 99, y: 99 } }),
      layout: makeLayout({ 'a.md': { x: 10, y: 20 } }),
    });
    expect(result.dirty).toBe(true);
    expect(result.next).toEqual(asMap({ 'a.md': { x: 10, y: 20 } }));
  });

  it('pins newly-loaded nodes against layout positions (dirty=true)', () => {
    const result = reconcile({
      nodes: [makeNode('a.md'), makeNode('new.md')],
      current: asMap({ 'a.md': { x: 10, y: 20 } }),
      layout: makeLayout({ 'a.md': { x: 10, y: 20 }, 'new.md': { x: 55, y: 66 } }),
    });
    expect(result.dirty).toBe(true);
    expect(result.next).toEqual(
      asMap({
        'a.md': { x: 10, y: 20 },
        'new.md': { x: 55, y: 66 },
      }),
    );
  });

  // Regression: see commit message. Pre-fix the helper set `dirty = true`
  // whenever `missing.length > 0`, even when `layout.positions` had not
  // yet learned about the missing ids (typical mid-flight during a WS
  // rename: `loader.nodes()` updates instantly, dagre runs async). The
  // host effect would then write a new ref with identical content, the
  // signal write re-fired the effect, and the loop pegged CPU at 100%+
  // until dagre finally emitted.
  it('missing paths with no matching layout entry: returns dirty=false (no rewrite loop)', () => {
    const result = reconcile({
      nodes: [makeNode('a.md'), makeNode('rename-target.md')],
      current: asMap({ 'a.md': { x: 10, y: 20 } }),
      // Layout is stale: dagre has not run for `rename-target.md` yet.
      layout: makeLayout({ 'a.md': { x: 10, y: 20 } }),
    });
    expect(result.dirty).toBe(false);
  });

  it('partial layout: applies the entries it has, ignores the rest (dirty=true on real change)', () => {
    const result = reconcile({
      nodes: [makeNode('a.md'), makeNode('known.md'), makeNode('unknown.md')],
      current: asMap({ 'a.md': { x: 10, y: 20 } }),
      layout: makeLayout({ 'a.md': { x: 10, y: 20 }, 'known.md': { x: 77, y: 88 } }),
    });
    expect(result.dirty).toBe(true);
    expect(result.next).toEqual(
      asMap({
        'a.md': { x: 10, y: 20 },
        'known.md': { x: 77, y: 88 },
      }),
    );
    expect(result.next.has('unknown.md')).toBe(false);
  });

  // Regression for the "pisar nodo" symptom. When a NEW node enters
  // the graph, dagre reshuffles every neighbour; keeping the AUTO
  // pin at its pre-relayout coordinate let the new node land on top
  // of an old one. Auto pins now follow dagre WHEN A NODE WAS ADDED.
  // Manual pins (user-dragged) stay put regardless.
  it('auto pins follow the freshest dagre output when a NEW node entered the graph', () => {
    const result = reconcile({
      // 'c.md' is new (not in `current`), triggering the auto-pin refresh.
      nodes: [makeNode('a.md'), makeNode('b.md'), makeNode('c.md')],
      current: asMap({
        'a.md': { x: 10, y: 20 }, // auto (no manual flag)
        'b.md': { x: 30, y: 40 },
      }),
      layout: makeLayout({
        'a.md': { x: 100, y: 200 }, // dagre moved it (because c was added)
        'b.md': { x: 30, y: 40 },
        'c.md': { x: 500, y: 600 },
      }),
    });
    expect(result.dirty).toBe(true);
    expect(result.next.get('a.md')).toEqual({ x: 100, y: 200 });
    expect(result.next.get('b.md')).toEqual({ x: 30, y: 40 });
    expect(result.next.get('c.md')).toEqual({ x: 500, y: 600 });
  });

  it('manual pins are preserved across dagre drift even when a new node arrives', () => {
    const result = reconcile({
      nodes: [makeNode('a.md'), makeNode('b.md'), makeNode('c.md')],
      current: asMap({
        'a.md': { x: 10, y: 20, manual: true },
        'b.md': { x: 30, y: 40 },
      }),
      layout: makeLayout({
        'a.md': { x: 999, y: 999 }, // dagre wants to move it; ignore
        'b.md': { x: 31, y: 41 }, // auto, follow dagre because c was added
        'c.md': { x: 500, y: 600 },
      }),
    });
    expect(result.dirty).toBe(true);
    expect(result.next.get('a.md')).toEqual({ x: 10, y: 20, manual: true });
    expect(result.next.get('b.md')).toEqual({ x: 31, y: 41 });
    expect(result.next.get('c.md')).toEqual({ x: 500, y: 600 });
  });

  // Regression for the "editar un .md mueve un nodo" symptom. When
  // the loaded path set is unchanged (typical body-only edit, even
  // one that adds / removes a link), dagre may relayout because the
  // edge set drifted, but auto pins must stay anchored so the user's
  // mental model "I edited one file, nothing else should move" holds.
  it('auto pins stay put when no new node entered the graph (pure edge / body change)', () => {
    const result = reconcile({
      nodes: [makeNode('a.md'), makeNode('b.md')],
      current: asMap({
        'a.md': { x: 10, y: 20 }, // auto
        'b.md': { x: 30, y: 40 }, // auto
      }),
      layout: makeLayout({
        // Dagre wants to move both because edges changed; we ignore
        // it because no node was added.
        'a.md': { x: 999, y: 999 },
        'b.md': { x: 888, y: 888 },
      }),
    });
    expect(result.dirty).toBe(false);
    expect(result.next.get('a.md')).toEqual({ x: 10, y: 20 });
    expect(result.next.get('b.md')).toEqual({ x: 30, y: 40 });
  });

  it('all auto pins match dagre exactly: dirty=false', () => {
    const result = reconcile({
      nodes: [makeNode('a.md')],
      current: asMap({ 'a.md': { x: 10, y: 20 } }),
      layout: makeLayout({ 'a.md': { x: 10, y: 20 } }),
    });
    expect(result.dirty).toBe(false);
  });

  // Regression for the map-view switch bug ("cuando switcheo de uno a
  // otro, no switcheo"): the apply effect writes the incoming view's
  // pins while `loader.nodes()` still holds the OUTGOING view's branch
  // (the refetch is async + debounced), and this reconcile fires on the
  // positions write. Pruning manual pins against that stale branch
  // destroyed the incoming pins and flipped the view dirty, detouring
  // every next switch into the confirm gate. Manual pins now prune
  // against the CORPUS only.
  it('manual pin on a node hidden from the branch but present in the corpus survives', () => {
    const result = reconcile({
      nodes: [makeNode('a.md')], // branch: only a.md visible
      current: asMap({
        'a.md': { x: 10, y: 20 },
        'hidden.md': { x: 50, y: 60, manual: true },
      }),
      layout: makeLayout({ 'a.md': { x: 10, y: 20 } }),
      corpusPaths: new Set(['a.md', 'hidden.md']),
    });
    expect(result.dirty).toBe(false);
    expect(result.next.get('hidden.md')).toEqual({ x: 50, y: 60, manual: true });
  });

  it('manual pin whose node left the corpus is garbage-collected', () => {
    const result = reconcile({
      nodes: [makeNode('a.md')],
      current: asMap({
        'a.md': { x: 10, y: 20 },
        'deleted.md': { x: 50, y: 60, manual: true },
      }),
      layout: makeLayout({ 'a.md': { x: 10, y: 20 } }),
      corpusPaths: new Set(['a.md']),
    });
    expect(result.dirty).toBe(true);
    expect(result.next.has('deleted.md')).toBe(false);
  });

  it('auto entry off the branch is dropped even while its node stays in the corpus', () => {
    const result = reconcile({
      nodes: [makeNode('a.md')],
      current: asMap({
        'a.md': { x: 10, y: 20 },
        'hidden-auto.md': { x: 50, y: 60 },
      }),
      layout: makeLayout({ 'a.md': { x: 10, y: 20 } }),
      corpusPaths: new Set(['a.md', 'hidden-auto.md']),
    });
    expect(result.dirty).toBe(true);
    expect(result.next.has('hidden-auto.md')).toBe(false);
  });
});
