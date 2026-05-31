import { describe, expect, it } from 'vitest';

import {
  buildRows,
  buildTree,
  computeAggregates,
  issueWeight,
  leafComparator,
  type IFolderLeaf,
  type IIssueMaps,
  type TFolderViewRow,
} from '../files-view.rows';
import type { IFilesSort } from '../files-view.sort';
import type { INodeView } from '../../../../models/node';

interface INodeOpts {
  name?: string;
  linksIn?: number;
  linksOut?: number;
  tokens?: number;
  stale?: boolean;
}

function makeNode(path: string, opts: INodeOpts = {}): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name: opts.name, description: '', metadata: { version: '1.0.0' } },
    linksInCount: opts.linksIn,
    linksOutCount: opts.linksOut,
    tokensTotal: opts.tokens,
    sidecar: opts.stale ? { status: 'stale-body' } : undefined,
  } as unknown as INodeView;
}

const NO_ISSUES: IIssueMaps = { errorCounts: new Map(), warnCounts: new Map() };

function maps(errors: Record<string, number> = {}, warns: Record<string, number> = {}): IIssueMaps {
  return {
    errorCounts: new Map(Object.entries(errors)),
    warnCounts: new Map(Object.entries(warns)),
  };
}

function tree(nodes: readonly INodeView[]): {
  tree: ReturnType<typeof buildTree>;
  aggregates: ReturnType<typeof computeAggregates>;
} {
  const t = buildTree(nodes);
  return { tree: t, aggregates: computeAggregates(t) };
}

function rowsFor(nodes: readonly INodeView[], sort: IFilesSort, m: IIssueMaps = NO_ISSUES): TFolderViewRow[] {
  const { tree: t, aggregates } = tree(nodes);
  return buildRows({ tree: t, leaves: nodes, collapsed: new Set(), aggregates, maps: m, sort });
}

const leaves = (rows: TFolderViewRow[]): IFolderLeaf[] =>
  rows.filter((r): r is IFolderLeaf => r.type === 'leaf');

describe('buildRows — tree mode (default)', () => {
  it('emits folder rows + leaves and keeps alpha order', () => {
    const nodes = [
      makeNode('src/b.md', { name: 'b' }),
      makeNode('src/a.md', { name: 'a' }),
      makeNode('z.md', { name: 'z' }),
    ];
    const rows = rowsFor(nodes, { column: 'tree', dir: 'asc' });
    expect(rows.map((r) => `${r.type}:${r.name}`)).toEqual([
      'folder:src',
      'leaf:a',
      'leaf:b',
      'leaf:z',
    ]);
    expect(rows.every((r) => r.type === 'folder' || r.depth >= 0)).toBe(true);
  });

  it('compacts a single-child chain leading to one file into one leaf row with a dimmed prefix', () => {
    const nodes = [makeNode('docs/guides/intro.md', { name: 'intro' })];
    const rows = rowsFor(nodes, { column: 'tree', dir: 'asc' });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.type).toBe('leaf');
    expect(row.name).toBe('intro');
    expect((row as IFolderLeaf).prefix).toBe('docs/guides/');
    expect(row.depth).toBe(0);
  });
});

describe('buildRows — flat mode', () => {
  const nodes = [
    makeNode('a.md', { name: 'a', linksIn: 5, linksOut: 1, tokens: 100 }),
    makeNode('b.md', { name: 'b', linksIn: 2, linksOut: 9, tokens: 300 }),
    makeNode('c.md', { name: 'c', linksIn: 8, linksOut: 4, tokens: 200 }),
  ];

  it('produces only leaves at depth 0 (no folder rows)', () => {
    const rows = rowsFor(nodes, { column: 'tokens', dir: 'desc' });
    expect(rows.every((r) => r.type === 'leaf')).toBe(true);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });

  it('sorts tokens desc and asc', () => {
    expect(leaves(rowsFor(nodes, { column: 'tokens', dir: 'desc' })).map((l) => l.name)).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(leaves(rowsFor(nodes, { column: 'tokens', dir: 'asc' })).map((l) => l.name)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('sorts linksIn and linksOut', () => {
    expect(leaves(rowsFor(nodes, { column: 'linksIn', dir: 'desc' })).map((l) => l.name)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(leaves(rowsFor(nodes, { column: 'linksOut', dir: 'desc' })).map((l) => l.name)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('puts the directory path (no trailing slash) in the dimmed prefix', () => {
    const rows = rowsFor([makeNode('docs/guides/intro.md', { name: 'intro' })], {
      column: 'tokens',
      dir: 'desc',
    });
    expect((rows[0] as IFolderLeaf).prefix).toBe('docs/guides');
    expect(rows[0].depth).toBe(0);
  });

  it('leaves the dimmed prefix empty for a root-level file', () => {
    const rows = rowsFor([makeNode('root.md', { name: 'root' })], {
      column: 'tokens',
      dir: 'desc',
    });
    expect((rows[0] as IFolderLeaf).prefix).toBe('');
  });
});

describe('missing-value ordering', () => {
  const nodes = [
    makeNode('has-100.md', { name: 'h100', tokens: 100 }),
    makeNode('missing.md', { name: 'miss' }), // tokensTotal undefined
    makeNode('has-0.md', { name: 'h0', tokens: 0 }),
  ];

  it('sinks missing values to the bottom under DESC', () => {
    expect(leaves(rowsFor(nodes, { column: 'tokens', dir: 'desc' })).map((l) => l.name)).toEqual([
      'h100',
      'h0',
      'miss',
    ]);
  });

  it('sinks missing values to the bottom under ASC too (a defined 0 is not "missing")', () => {
    expect(leaves(rowsFor(nodes, { column: 'tokens', dir: 'asc' })).map((l) => l.name)).toEqual([
      'h0',
      'h100',
      'miss',
    ]);
  });
});

describe('issueWeight', () => {
  it('lets one error outrank any realistic warn count', () => {
    expect(issueWeight({ errors: 1, warns: 0, isStale: false })).toBeGreaterThan(
      issueWeight({ errors: 0, warns: 999, isStale: false }),
    );
  });

  it('lets one warn outrank a stale flag', () => {
    expect(issueWeight({ errors: 0, warns: 1, isStale: false })).toBeGreaterThan(
      issueWeight({ errors: 0, warns: 0, isStale: true }),
    );
  });

  it('orders the Issues column error-heavy > warn-heavy > stale > clean', () => {
    const nodes = [
      makeNode('clean.md', { name: 'clean' }),
      makeNode('stale.md', { name: 'stale', stale: true }),
      makeNode('warn.md', { name: 'warn' }),
      makeNode('err.md', { name: 'err' }),
    ];
    const m = maps({ 'err.md': 2 }, { 'warn.md': 3 });
    expect(leaves(rowsFor(nodes, { column: 'issues', dir: 'desc' }, m)).map((l) => l.name)).toEqual(
      ['err', 'warn', 'stale', 'clean'],
    );
  });
});

describe('leafComparator stability', () => {
  it('breaks ties on path ascending regardless of direction', () => {
    const a = { path: 'a.md', tokensRaw: 10 } as IFolderLeaf;
    const b = { path: 'b.md', tokensRaw: 10 } as IFolderLeaf;
    expect(leafComparator('tokens', 'desc')(a, b)).toBeLessThan(0);
    expect(leafComparator('tokens', 'asc')(a, b)).toBeLessThan(0);
  });
});
