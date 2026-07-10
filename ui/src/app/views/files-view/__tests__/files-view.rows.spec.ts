import { describe, expect, it } from 'vitest';

import {
  buildRows,
  buildTree,
  computeAggregates,
  issueMapsFromLite,
  issueWeight,
  leafAncestorFolderPaths,
  leafComparator,
  makeLeafRow,
  type IFolderLeaf,
  type IFolderRow,
  type IIssueMaps,
  type TFolderViewRow,
} from '../files-view.rows';
import { FILES_VIEW_TEXTS } from '../../../../i18n/files-view.texts';
import type { IFilesSort } from '../files-view.sort';
import type { INodeView, TFrontmatter } from '../../../../models/node';
import type { IFolderNodeLite } from '../../../../models/api';

interface INodeOpts {
  name?: string;
  kind?: string;
  linksIn?: number;
  linksOut?: number;
  tokens?: number;
  stale?: boolean;
  modified?: number;
}

function makeNode(path: string, opts: INodeOpts = {}): INodeView {
  return {
    path,
    kind: opts.kind ?? 'agent',
    frontmatter: { name: opts.name, description: '', metadata: { version: '1.0.0' } },
    linksInCount: opts.linksIn,
    linksOutCount: opts.linksOut,
    tokensTotal: opts.tokens,
    modifiedAtMs: opts.modified,
    sidecar: opts.stale ? { status: 'stale-body' } : undefined,
  } as unknown as INodeView;
}

/**
 * Build an `IFolderNodeLite` row. `linksInCount` / `linksOutCount`
 * default to 0 and `tokensTotal` / `modifiedAtMs` to `null` so a test
 * only has to name the fields it cares about.
 */
function liteRow(path: string, opts: Partial<IFolderNodeLite> = {}): IFolderNodeLite {
  return {
    path,
    kind: opts.kind ?? 'agent',
    linksInCount: opts.linksInCount ?? 0,
    linksOutCount: opts.linksOutCount ?? 0,
    tokensTotal: opts.tokensTotal ?? null,
    modifiedAtMs: opts.modifiedAtMs ?? null,
    errorCount: opts.errorCount ?? 0,
    warnCount: opts.warnCount ?? 0,
    sidecarStatus: opts.sidecarStatus ?? null,
  };
}

/**
 * Mirror of `projectLiteNode` in `collection-loader.ts`: turn a lite
 * folders row into the minimal `INodeView` the files-view consumes, so
 * the leaf-row assertions exercise the same lite -> view -> column flow
 * the rail uses at runtime. Nullable wire fields coerce to `undefined`.
 */
function projectLite(lite: IFolderNodeLite): INodeView {
  return {
    path: lite.path,
    kind: lite.kind,
    frontmatter: { name: '', description: '' } as TFrontmatter,
    linksInCount: lite.linksInCount,
    linksOutCount: lite.linksOutCount,
    tokensTotal: lite.tokensTotal ?? undefined,
    modifiedAtMs: lite.modifiedAtMs ?? undefined,
  };
}

const NO_ISSUES: IIssueMaps = { errorCounts: new Map(), warnCounts: new Map() };

/** No agent activity this session (the default for most row tests). */
const NO_ACTIVITY: ReadonlyMap<string, number> = new Map();

function maps(errors: Record<string, number> = {}, warns: Record<string, number> = {}): IIssueMaps {
  return {
    errorCounts: new Map(Object.entries(errors)),
    warnCounts: new Map(Object.entries(warns)),
  };
}

function activityOf(counts: Record<string, number>): ReadonlyMap<string, number> {
  return new Map(Object.entries(counts));
}

function tree(nodes: readonly INodeView[], m: IIssueMaps = NO_ISSUES): {
  tree: ReturnType<typeof buildTree>;
  aggregates: ReturnType<typeof computeAggregates>;
} {
  const t = buildTree(nodes);
  return { tree: t, aggregates: computeAggregates(t, m) };
}

/** Every folder path in the tree, so a tree-mode render comes back fully
 *  expanded (the default state is now "all collapsed", an empty set). */
function allFolderPaths(t: ReturnType<typeof buildTree>): Set<string> {
  const out = new Set<string>();
  const visit = (folder: ReturnType<typeof buildTree>): void => {
    if (folder.path) out.add(folder.path);
    for (const sub of folder.subfolders.values()) visit(sub);
  };
  visit(t);
  return out;
}

function rowsFor(
  nodes: readonly INodeView[],
  sort: IFilesSort,
  m: IIssueMaps = NO_ISSUES,
  activityCounts: ReadonlyMap<string, number> = NO_ACTIVITY,
): TFolderViewRow[] {
  const { tree: t, aggregates } = tree(nodes, m);
  return buildRows({
    tree: t,
    leaves: nodes,
    expanded: allFolderPaths(t),
    aggregates,
    maps: m,
    activityCounts,
    sort,
  });
}

const folders = (rows: TFolderViewRow[]): IFolderRow[] =>
  rows.filter((r): r is IFolderRow => r.type === 'folder');

const leaves = (rows: TFolderViewRow[]): IFolderLeaf[] =>
  rows.filter((r): r is IFolderLeaf => r.type === 'leaf');

describe('buildRows: tree mode (default)', () => {
  it('emits folder rows + leaves and keeps alpha order', () => {
    const nodes = [
      makeNode('src/b.md', { name: 'b' }),
      makeNode('src/a.md', { name: 'a' }),
      makeNode('z.md', { name: 'z' }),
    ];
    const rows = rowsFor(nodes, { column: 'tree', dir: 'asc' });
    expect(rows.map((r) => `${r.type}:${r.name}`)).toEqual([
      'folder:src',
      'leaf:a.md',
      'leaf:b.md',
      'leaf:z.md',
    ]);
    expect(rows.every((r) => r.type === 'folder' || r.depth >= 0)).toBe(true);
  });

  it('compacts a single-child chain leading to one file into one leaf row with a dimmed prefix', () => {
    const nodes = [makeNode('docs/guides/intro.md', { name: 'intro' })];
    const rows = rowsFor(nodes, { column: 'tree', dir: 'asc' });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.type).toBe('leaf');
    // Ordinary folded leaf shows its real filename (with extension), the
    // chain riding in the dimmed prefix and no fixed-filename suffix.
    expect(row.name).toBe('intro.md');
    expect((row as IFolderLeaf).prefix).toBe('docs/guides/');
    expect((row as IFolderLeaf).suffix).toBe('');
    expect((row as IFolderLeaf).nameMuted).toBe(false);
    expect(row.depth).toBe(0);
  });

  it('renders a folded skill leaf as bold folder + dimmed /SKILL.md, folder never repeated', () => {
    const nodes = [
      makeNode('.claude/skills/notion-publish/SKILL.md', { kind: 'skill', name: 'notion-publish' }),
    ];
    const rows = rowsFor(nodes, { column: 'tree', dir: 'asc' });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.type).toBe('leaf');
    // Bold name = the skill folder; the fixed file rides as a dimmed tail;
    // only the folders ABOVE the skill folder stay in the prefix.
    expect(row.name).toBe('notion-publish');
    expect((row as IFolderLeaf).suffix).toBe('/SKILL.md');
    expect((row as IFolderLeaf).prefix).toBe('.claude/skills/');
    expect((row as IFolderLeaf).nameMuted).toBe(false); // folder IS the bold name
  });

  it('folds an open-standard SKILL.md even under a FOREIGN lens (kind is markdown, not skill)', () => {
    // `.agents/skills/<name>/SKILL.md` scanned with the Claude lens active
    // lands as kind 'markdown'; the entry file must still fold to the folder.
    const nodes = [makeNode('.agents/skills/full-skill-agents/SKILL.md', { kind: 'markdown' })];
    const rows = rowsFor(nodes, { column: 'tree', dir: 'asc' });
    const [row] = rows;
    expect(row.name).toBe('full-skill-agents');
    expect((row as IFolderLeaf).suffix).toBe('/SKILL.md');
    expect((row as IFolderLeaf).prefix).toBe('.agents/skills/');
    expect((row as IFolderLeaf).nameMuted).toBe(false);
  });

  it('dims a folded-away skill leaf but keeps ordinary siblings bold when the folder is a row', () => {
    const nodes = [
      makeNode('.claude/skills/notion-publish/SKILL.md', { kind: 'skill', name: 'notion-publish' }),
      makeNode('.claude/skills/notion-publish/reference.md', { name: 'reference' }), // ordinary sibling
    ];
    const rows = rowsFor(nodes, { column: 'tree', dir: 'asc' });
    // notion-publish has 2 leaves -> its own folder row (not compacted), so
    // the leaves keep their real filenames (identity lives in the folder row).
    expect(folders(rows).map((f) => f.name)).toEqual(['.claude/skills/notion-publish']);
    const leafRows = leaves(rows);
    expect([...leafRows.map((l) => l.name)].sort()).toEqual(['SKILL.md', 'reference.md'].sort());
    expect(leafRows.every((l) => l.suffix === '')).toBe(true);
    // SKILL.md is dimmed (fixed convention filename); the ordinary sibling stays bold.
    const skillLeaf = leafRows.find((l) => l.path.endsWith('SKILL.md'));
    const refLeaf = leafRows.find((l) => l.path.endsWith('reference.md'));
    expect(skillLeaf?.nameMuted).toBe(true);
    expect(refLeaf?.nameMuted).toBe(false);
  });

  it('dims the SKILL.md leaf when the skill folder becomes a row via SUBFOLDERS (reported case)', () => {
    const nodes = [
      makeNode('.claude/skills/notion-publish/SKILL.md', { kind: 'skill', name: 'notion-publish' }),
      makeNode('.claude/skills/notion-publish/references/guide.md', { name: 'guide' }),
    ];
    const rows = rowsFor(nodes, { column: 'tree', dir: 'asc' });
    // The subfolder makes notion-publish a folder row; SKILL.md (its only
    // direct leaf) must NOT stay bold, the folder above carries the name.
    const skillLeaf = leaves(rows).find((l) => l.path.endsWith('SKILL.md'));
    expect(skillLeaf?.name).toBe('SKILL.md');
    expect(skillLeaf?.suffix).toBe('');
    expect(skillLeaf?.nameMuted).toBe(true);
    const guideLeaf = leaves(rows).find((l) => l.path.endsWith('guide.md'));
    expect(guideLeaf?.nameMuted).toBe(false);
  });

  it('collapses every folder by default (empty expanded set), revealing children only when expanded', () => {
    const nodes = [makeNode('src/a.md', { name: 'a' }), makeNode('src/b.md', { name: 'b' })];
    const { tree: t, aggregates } = tree(nodes);
    const sort: IFilesSort = { column: 'tree', dir: 'asc' };
    // Default: nothing expanded -> only the top-level folder row, no leaves.
    const collapsed = buildRows({ tree: t, leaves: nodes, expanded: new Set(), aggregates, maps: NO_ISSUES, activityCounts: NO_ACTIVITY, sort });
    expect(collapsed.map((r) => `${r.type}:${r.name}`)).toEqual(['folder:src']);
    expect((collapsed[0] as IFolderRow).expanded).toBe(false);
    // Expanding 'src' reveals its leaves.
    const opened = buildRows({ tree: t, leaves: nodes, expanded: new Set(['src']), aggregates, maps: NO_ISSUES, activityCounts: NO_ACTIVITY, sort });
    expect(opened.map((r) => `${r.type}:${r.name}`)).toEqual(['folder:src', 'leaf:a.md', 'leaf:b.md']);
    expect((opened[0] as IFolderRow).expanded).toBe(true);
  });
});

describe('buildRows: flat mode', () => {
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
    expect(leaves(rowsFor(nodes, { column: 'tokens', dir: 'desc' })).map((l) => l.path)).toEqual([
      'b.md',
      'c.md',
      'a.md',
    ]);
    expect(leaves(rowsFor(nodes, { column: 'tokens', dir: 'asc' })).map((l) => l.path)).toEqual([
      'a.md',
      'c.md',
      'b.md',
    ]);
  });

  it('sorts linksIn and linksOut', () => {
    expect(leaves(rowsFor(nodes, { column: 'linksIn', dir: 'desc' })).map((l) => l.path)).toEqual([
      'c.md',
      'a.md',
      'b.md',
    ]);
    expect(leaves(rowsFor(nodes, { column: 'linksOut', dir: 'desc' })).map((l) => l.path)).toEqual([
      'b.md',
      'c.md',
      'a.md',
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

  it('splits a skill leaf into bold folder + dimmed /SKILL.md with the parent dir trailing', () => {
    const rows = rowsFor(
      [makeNode('.claude/skills/notion-publish/SKILL.md', { kind: 'skill', name: 'notion-publish' })],
      { column: 'tokens', dir: 'desc' },
    );
    const [row] = rows;
    expect(row.type).toBe('leaf');
    expect(row.name).toBe('notion-publish');
    expect((row as IFolderLeaf).suffix).toBe('/SKILL.md');
    expect((row as IFolderLeaf).nameMuted).toBe(false); // folder IS the bold name
    // FLAT dir trails after the name, minus the folder (now the bold name).
    expect((row as IFolderLeaf).prefix).toBe('.claude/skills');
  });

  it('splits an open-standard SKILL.md in FLAT mode even under a foreign lens (kind markdown)', () => {
    const rows = rowsFor(
      [makeNode('.agents/skills/full-skill-agents/SKILL.md', { kind: 'markdown' })],
      { column: 'tokens', dir: 'desc' },
    );
    const [row] = rows;
    expect(row.name).toBe('full-skill-agents');
    expect((row as IFolderLeaf).suffix).toBe('/SKILL.md');
    expect((row as IFolderLeaf).prefix).toBe('.agents/skills');
    expect((row as IFolderLeaf).nameMuted).toBe(false);
  });
});

describe('missing-value ordering', () => {
  const nodes = [
    makeNode('has-100.md', { name: 'h100', tokens: 100 }),
    makeNode('missing.md', { name: 'miss' }), // tokensTotal undefined
    makeNode('has-0.md', { name: 'h0', tokens: 0 }),
  ];

  it('sinks missing values to the bottom under DESC', () => {
    expect(leaves(rowsFor(nodes, { column: 'tokens', dir: 'desc' })).map((l) => l.path)).toEqual([
      'has-100.md',
      'has-0.md',
      'missing.md',
    ]);
  });

  it('sinks missing values to the bottom under ASC too (a defined 0 is not "missing")', () => {
    expect(leaves(rowsFor(nodes, { column: 'tokens', dir: 'asc' })).map((l) => l.path)).toEqual([
      'has-0.md',
      'has-100.md',
      'missing.md',
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
    expect(leaves(rowsFor(nodes, { column: 'issues', dir: 'desc' }, m)).map((l) => l.path)).toEqual(
      ['err.md', 'warn.md', 'stale.md', 'clean.md'],
    );
  });

  it('orders the Modified column by mtime and sinks fileless nodes to the bottom both ways', () => {
    const nodes = [
      makeNode('old.md', { name: 'old', modified: 1_000 }),
      makeNode('new.md', { name: 'new', modified: 9_000 }),
      makeNode('mid.md', { name: 'mid', modified: 5_000 }),
      makeNode('none.md', { name: 'none' }), // no mtime → always last
    ];
    expect(leaves(rowsFor(nodes, { column: 'modified', dir: 'desc' })).map((l) => l.path)).toEqual(
      ['new.md', 'mid.md', 'old.md', 'none.md'],
    );
    expect(leaves(rowsFor(nodes, { column: 'modified', dir: 'asc' })).map((l) => l.path)).toEqual(
      ['old.md', 'mid.md', 'new.md', 'none.md'],
    );
  });

  it('renders the Modified cell as an ISO short date with a full-datetime tooltip', () => {
    const nodes = [makeNode('a.md', { name: 'a', modified: 1_749_823_967_000 })];
    const [leaf] = leaves(rowsFor(nodes, { column: 'modified', dir: 'desc' }));
    expect(leaf?.modifiedAt).toBe('2025-06-13');
    expect(leaf?.modifiedAtFull).toBe('2025-06-13 14:12:47Z');
  });
});

describe('issueMapsFromLite', () => {
  it('keys per-node error / warn counts from the lite folders list', () => {
    const lite: IFolderNodeLite[] = [
      liteRow('src/a.md', { errorCount: 2, warnCount: 1 }),
      liteRow('src/b.md', { errorCount: 0, warnCount: 3 }),
      liteRow('clean.md', { kind: 'note', errorCount: 0, warnCount: 0 }),
    ];
    const m = issueMapsFromLite(lite);
    expect(m.errorCounts.get('src/a.md')).toBe(2);
    expect(m.warnCounts.get('src/a.md')).toBe(1);
    expect(m.warnCounts.get('src/b.md')).toBe(3);
    // Zero-count nodes are omitted (no key) so `?? 0` reads naturally.
    expect(m.errorCounts.has('src/b.md')).toBe(false);
    expect(m.errorCounts.has('clean.md')).toBe(false);
    expect(m.warnCounts.has('clean.md')).toBe(false);
  });
});

describe('lite folders row -> leaf data columns', () => {
  it('renders the real link / token / modified values a lite item carries', () => {
    const view = projectLite(
      liteRow('docs/a.md', {
        linksInCount: 7,
        linksOutCount: 3,
        tokensTotal: 1_280,
        modifiedAtMs: 1_749_823_967_000,
      }),
    );
    const leaf = makeLeafRow(view, 0, NO_ISSUES, NO_ACTIVITY);
    expect(leaf.linksIn).toBe('7');
    expect(leaf.linksOut).toBe('3');
    expect(leaf.tokens).toBe('1.3k');
    expect(leaf.modifiedAt).toBe('2025-06-13');
    expect(leaf.linksInRaw).toBe(7);
    expect(leaf.linksOutRaw).toBe(3);
    expect(leaf.tokensRaw).toBe(1_280);
    expect(leaf.modifiedAtRaw).toBe(1_749_823_967_000);
    // None of the data cells fell back to the missing glyph.
    expect(leaf.linksIn).not.toBe(FILES_VIEW_TEXTS.missing);
    expect(leaf.tokens).not.toBe(FILES_VIEW_TEXTS.missing);
    expect(leaf.modifiedAt).not.toBe(FILES_VIEW_TEXTS.missing);
  });

  it('shows the missing glyph for tokens / modified when the lite item is null', () => {
    // Link counts are always present (0, not null); tokens + mtime are
    // null for virtual / derived nodes and coerce to `·`.
    const view = projectLite(
      liteRow('virtual.md', { linksInCount: 0, linksOutCount: 0 }),
    );
    const leaf = makeLeafRow(view, 0, NO_ISSUES, NO_ACTIVITY);
    expect(leaf.linksIn).toBe('0');
    expect(leaf.linksOut).toBe('0');
    expect(leaf.tokens).toBe(FILES_VIEW_TEXTS.missing);
    expect(leaf.modifiedAt).toBe(FILES_VIEW_TEXTS.missing);
    expect(leaf.modifiedAtFull).toBe('');
    expect(leaf.tokensRaw).toBeUndefined();
    expect(leaf.modifiedAtRaw).toBeUndefined();
  });
});

describe('Activity column (session execution counts)', () => {
  const nodes = [
    makeNode('a.md', { name: 'a' }),
    makeNode('b.md', { name: 'b' }),
    makeNode('c.md', { name: 'c' }),
  ];

  it('sorts by activity desc and asc', () => {
    const activity = activityOf({ 'a.md': 3, 'b.md': 12, 'c.md': 1 });
    expect(
      leaves(rowsFor(nodes, { column: 'activity', dir: 'desc' }, NO_ISSUES, activity)).map((l) => l.path),
    ).toEqual(['b.md', 'a.md', 'c.md']);
    expect(
      leaves(rowsFor(nodes, { column: 'activity', dir: 'asc' }, NO_ISSUES, activity)).map((l) => l.path),
    ).toEqual(['c.md', 'a.md', 'b.md']);
  });

  it('sinks never-invoked nodes (no map entry) to the bottom both ways', () => {
    const activity = activityOf({ 'a.md': 5, 'c.md': 2 }); // b.md never invoked
    expect(
      leaves(rowsFor(nodes, { column: 'activity', dir: 'desc' }, NO_ISSUES, activity)).map((l) => l.path),
    ).toEqual(['a.md', 'c.md', 'b.md']);
    expect(
      leaves(rowsFor(nodes, { column: 'activity', dir: 'asc' }, NO_ISSUES, activity)).map((l) => l.path),
    ).toEqual(['c.md', 'a.md', 'b.md']);
  });

  it('renders a compact count on the leaf and the missing glyph when absent', () => {
    const view = projectLite(liteRow('docs/hot.md'));
    const withCount = makeLeafRow(view, 0, NO_ISSUES, activityOf({ 'docs/hot.md': 1_280 }));
    expect(withCount.activity).toBe('1.3k');
    expect(withCount.activityRaw).toBe(1_280);
    const without = makeLeafRow(view, 0, NO_ISSUES, NO_ACTIVITY);
    expect(without.activity).toBe(FILES_VIEW_TEXTS.missing);
    expect(without.activityRaw).toBeUndefined();
  });
});

describe('folder severity badges (recursive roll-up)', () => {
  it('sums descendant error / warn counts onto each folder row', () => {
    const nodes = [
      makeNode('src/api/a.md', { name: 'a' }),
      makeNode('src/api/b.md', { name: 'b' }),
      makeNode('src/c.md', { name: 'c' }),
    ];
    const m = maps({ 'src/api/a.md': 2, 'src/c.md': 1 }, { 'src/api/b.md': 4 });
    const rows = rowsFor(nodes, { column: 'tree', dir: 'asc' }, m);
    const byPath = new Map(folders(rows).map((f) => [f.path, f]));
    // src rolls up the whole subtree: 3 errors (2 + 1), 4 warns.
    expect(byPath.get('src')?.errors).toBe(3);
    expect(byPath.get('src')?.warns).toBe(4);
    // src/api rolls up only its two leaves: 2 errors, 4 warns.
    expect(byPath.get('src/api')?.errors).toBe(2);
    expect(byPath.get('src/api')?.warns).toBe(4);
  });

  it('reports zero badges for a folder with no descendant issues', () => {
    const nodes = [makeNode('docs/x.md', { name: 'x' }), makeNode('docs/y.md', { name: 'y' })];
    const rows = rowsFor(nodes, { column: 'tree', dir: 'asc' }, NO_ISSUES);
    const folder = folders(rows).find((f) => f.path === 'docs');
    expect(folder?.errors).toBe(0);
    expect(folder?.warns).toBe(0);
  });
});

describe('leafAncestorFolderPaths', () => {
  it('returns the enclosing folder prefixes in root -> leaf order', () => {
    expect(leafAncestorFolderPaths('a/b/c.md')).toEqual(['a', 'a/b']);
  });

  it('returns an empty list for a root-level file', () => {
    expect(leafAncestorFolderPaths('root.md')).toEqual([]);
  });

  it('matches the `/`-joined folder paths that buildTree emits', () => {
    const t = buildTree([makeNode('src/api/a.md', { name: 'a' })]);
    const folderPaths = new Set<string>();
    const visit = (folder: ReturnType<typeof buildTree>): void => {
      if (folder.path) folderPaths.add(folder.path);
      for (const sub of folder.subfolders.values()) visit(sub);
    };
    visit(t);
    // Every ancestor the reveal effect would expand is a real tree folder.
    for (const p of leafAncestorFolderPaths('src/api/a.md')) {
      expect(folderPaths.has(p)).toBe(true);
    }
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
