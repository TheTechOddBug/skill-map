/**
 * Tests for the graph-view topology helpers and the visible-subset
 * projection. The `topologyFingerprint` cache key drives the
 * "graph stays put on WS push" behaviour: when paths + edges are
 * unchanged, the graph view's async layout effect skips the dagre
 * call and reuses the cached positions.
 *
 * Dagre's `calculate()` path is covered by Foblex upstream; we only
 * test the pure helpers we own here. Visual smoke for the engine
 * integration is exercised in the dev server.
 */

import { describe, expect, it } from 'vitest';

import {
  projectVisible,
  resolveTopology,
  topologyFingerprint,
  type IFullLayout,
  type IGraphEdge,
} from '../graph-layout';
import type { INodeView } from '../../../../models/node';
import type { ILinkApi, INodeApi, IScanResultApi } from '../../../../models/api';

// ---------------------------------------------------------------------------
// Fixture builders, keep them tiny + literal so the tests double as docs.
// ---------------------------------------------------------------------------

function nodeView(path: string, frontmatterDescription = ''): INodeView {
  return {
    path,
    kind: 'markdown',
    frontmatter: {
      name: path,
      description: frontmatterDescription,
      metadata: { version: '0.0.1' },
    },
  };
}

function apiNode(path: string, bytesTotal = 100): INodeApi {
  return {
    path,
    kind: 'markdown',
    provider: 'claude',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 10, body: bytesTotal - 10, total: bytesTotal },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

function link(source: string, target: string, kind: ILinkApi['kind'] = 'invokes'): ILinkApi {
  return {
    source,
    target,
    kind,
    confidence: 0.9,
    sources: ['ext'],
  };
}

function scan(nodes: INodeApi[], links: ILinkApi[]): IScanResultApi {
  return {
    schemaVersion: 1,
    scannedAt: 0,
    roots: ['/tmp/x'],
    nodes,
    links,
    issues: [],
    stats: {
      filesWalked: nodes.length,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: links.length,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// topologyFingerprint
// ---------------------------------------------------------------------------

describe('topologyFingerprint', () => {
  it('is stable under permutation of nodes and edges', () => {
    const e: IGraphEdge[] = [
      { id: 'invokes:a::b', from: 'a', to: 'b', kind: 'invokes', confidence: 0.6 },
      { id: 'invokes:c::d', from: 'c', to: 'd', kind: 'invokes', confidence: 0.6 },
    ];
    const nodesA = [nodeView('a'), nodeView('b'), nodeView('c'), nodeView('d')];
    const nodesB = [nodeView('d'), nodeView('a'), nodeView('c'), nodeView('b')];
    const edgesReversed = [...e].reverse();
    expect(topologyFingerprint(nodesA, e)).toBe(topologyFingerprint(nodesB, edgesReversed));
  });

  it('changes when a node is added', () => {
    const e: IGraphEdge[] = [];
    const before = topologyFingerprint([nodeView('a'), nodeView('b')], e);
    const after = topologyFingerprint([nodeView('a'), nodeView('b'), nodeView('c')], e);
    expect(before).not.toBe(after);
  });

  it('changes when an edge is added', () => {
    const nodes = [nodeView('a'), nodeView('b')];
    const before = topologyFingerprint(nodes, []);
    const after = topologyFingerprint(nodes, [
      { id: 'invokes:a::b', from: 'a', to: 'b', kind: 'invokes', confidence: 0.6 },
    ]);
    expect(before).not.toBe(after);
  });

  it('does NOT change when only frontmatter content differs', () => {
    const e: IGraphEdge[] = [];
    const before = topologyFingerprint([nodeView('a', 'old'), nodeView('b', 'old')], e);
    const after = topologyFingerprint([nodeView('a', 'NEW'), nodeView('b', 'NEW')], e);
    expect(before).toBe(after);
  });
});

// ---------------------------------------------------------------------------
// resolveTopology, edge resolution + index maps
// ---------------------------------------------------------------------------

describe('resolveTopology', () => {
  it('handles a null scan (no edges)', () => {
    const result = resolveTopology([nodeView('a'), nodeView('b')], null);
    expect(result.edges).toHaveLength(0);
    expect(result.nodesByPath.size).toBe(2);
    expect(result.apiNodesByPath.size).toBe(0);
  });

  it('builds indexed maps from the loaded set', () => {
    const result = resolveTopology(
      [nodeView('a', 'desc-a'), nodeView('b', 'desc-b')],
      scan([apiNode('a', 123), apiNode('b', 456)], []),
    );
    expect(result.nodesByPath.get('a')?.frontmatter.description).toBe('desc-a');
    expect(result.apiNodesByPath.get('a')?.bytes.total).toBe(123);
    expect(result.apiNodesByPath.get('b')?.bytes.total).toBe(456);
  });

  it('drops links pointing to unknown paths', () => {
    const result = resolveTopology(
      [nodeView('a'), nodeView('b')],
      scan([apiNode('a'), apiNode('b')], [link('a', 'b'), link('a', 'GHOST')]),
    );
    expect(result.edges).toHaveLength(1);
  });

  it('preserves both directions when a pair references each other', () => {
    const result = resolveTopology(
      [nodeView('a'), nodeView('b')],
      // edgeId() keeps direction, a→b and b→a are distinct edges so
      // the graph can render both arrows and the operator does not
      // lose direction info.
      scan(
        [apiNode('a'), apiNode('b')],
        [link('a', 'b', 'invokes'), link('b', 'a', 'invokes')],
      ),
    );
    expect(result.edges).toHaveLength(2);
    const ids = result.edges.map((e) => e.id).sort();
    expect(ids).toEqual(['invokes:a::b', 'invokes:b::a']);
  });

  it('still dedupes when the exact same directed link is emitted twice', () => {
    const result = resolveTopology(
      [nodeView('a'), nodeView('b')],
      scan(
        [apiNode('a'), apiNode('b')],
        // Same direction twice (e.g. two extractors flagging the same
        // edge) collapses to one edge thanks to the kind+from+to id.
        [link('a', 'b', 'invokes'), link('a', 'b', 'invokes')],
      ),
    );
    expect(result.edges).toHaveLength(1);
  });

  it('drops self-links (source === target)', () => {
    const result = resolveTopology(
      [nodeView('a')],
      scan([apiNode('a')], [link('a', 'a')]),
    );
    expect(result.edges).toHaveLength(0);
  });

  it('keeps the max confidence when two links collapse into the same edge', () => {
    // Two extractors flag the same (kind, source, target) tuple with
    // different confidences (e.g. annotations at 1.0, at-directive at
    // 0.5). The edge that materialises in the graph carries the
    // strongest signal so the opacity binding follows the most certain
    // emission, not whichever happened to be merged in first.
    const noisy = { ...link('a', 'b', 'references'), confidence: 0.5 };
    const strong = { ...link('a', 'b', 'references'), confidence: 1.0 };
    const result = resolveTopology(
      [nodeView('a'), nodeView('b')],
      scan([apiNode('a'), apiNode('b')], [noisy, strong]),
    );
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.confidence).toBe(1.0);
  });

  it('takes the strong confidence even when it lands after the weak one', () => {
    // Order-independence regression guard. Same payload as above but
    // the strong emission lands first; max-merge must still hold.
    const strong = { ...link('a', 'b', 'references'), confidence: 1.0 };
    const noisy = { ...link('a', 'b', 'references'), confidence: 0.5 };
    const result = resolveTopology(
      [nodeView('a'), nodeView('b')],
      scan([apiNode('a'), apiNode('b')], [strong, noisy]),
    );
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.confidence).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// projectVisible, filter projection on top of the cached layout
// ---------------------------------------------------------------------------

describe('projectVisible', () => {
  function buildLayout(
    paths: string[],
    edges: IGraphEdge[],
    positions: Record<string, { x: number; y: number }>,
  ): IFullLayout {
    const nodesByPath = new Map<string, INodeView>();
    const apiNodesByPath = new Map<string, INodeApi>();
    for (const p of paths) {
      nodesByPath.set(p, nodeView(p));
      apiNodesByPath.set(p, apiNode(p));
    }
    const positionsMap = new Map<string, { x: number; y: number }>();
    for (const [k, v] of Object.entries(positions)) positionsMap.set(k, v);
    return { nodesByPath, apiNodesByPath, edges, positions: positionsMap, computedAt: 0 };
  }

  it('renders only nodes in visibleIds', () => {
    const layout = buildLayout(
      ['a', 'b', 'c'],
      [],
      { a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, c: { x: 20, y: 20 } },
    );
    const result = projectVisible(layout, new Set(['a', 'c']), new Map());
    expect(result.nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
  });

  it('filters edges to those with both endpoints visible', () => {
    const layout = buildLayout(
      ['a', 'b', 'c'],
      [
        { id: 'invokes:a::b', from: 'a', to: 'b', kind: 'invokes', confidence: 0.6 },
        { id: 'invokes:b::c', from: 'b', to: 'c', kind: 'invokes', confidence: 0.6 },
      ],
      { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } },
    );
    const result = projectVisible(layout, new Set(['a', 'b']), new Map());
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.id).toBe('invokes:a::b');
  });

  it('counts visible-only edges in linksIn / linksOut', () => {
    const layout = buildLayout(
      ['a', 'b', 'c'],
      [
        { id: 'invokes:a::b', from: 'a', to: 'b', kind: 'invokes', confidence: 0.6 },
        { id: 'invokes:b::c', from: 'b', to: 'c', kind: 'invokes', confidence: 0.6 },
      ],
      { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } },
    );
    // Only a + b visible → b has linksIn=1 from a, linksOut=0 (b→c is hidden).
    const result = projectVisible(layout, new Set(['a', 'b']), new Map());
    const b = result.nodes.find((n) => n.id === 'b');
    expect(b?.stats.linksIn).toBe(1);
    expect(b?.stats.linksOut).toBe(0);
  });

  it('drag-override position wins over cached layout position', () => {
    const layout = buildLayout(['a'], [], { a: { x: 100, y: 100 } });
    const result = projectVisible(layout, new Set(['a']), new Map([['a', { x: 999, y: 888 }]]));
    expect(result.nodes[0]?.position).toEqual({ x: 999, y: 888 });
  });

  it('falls back to (0,0) when a visible id has no cached position', () => {
    const layout = buildLayout(['a'], [], {});
    const result = projectVisible(layout, new Set(['a']), new Map());
    expect(result.nodes[0]?.position).toEqual({ x: 0, y: 0 });
  });
});
