import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { FilesView } from '../files-view';
import { settleVirtualScroll } from '../../../../testing/virtual-scroll';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { MapVisibilityService } from '../../../../services/map-visibility';
import { NodeActivityStatsService } from '../../../../services/node-activity-stats';
import { MAP_ISOLATE_INTENT } from '../../../slots/map-isolate-intent';
import { NODE_OPEN_INTENT } from '../../../slots/node-open-intent';
import type { INodeView } from '../../../../models/node';
import type { IFolderNodeLite, INodeActivityStatsApi, IScanResultApi } from '../../../../models/api';

/**
 * FilesView leaf-row interactions (DOM-level).
 *
 * Guards the rail's two distinct leaf gestures so they stay separate:
 *   - clicking the row activates "open in map" (`NODE_OPEN_INTENT`);
 *   - clicking the sitemap / isolate button fires the isolate gesture
 *     (`MAP_ISOLATE_INTENT`) and stops propagation, so the row's own
 *     open-intent does NOT also fire.
 *
 * Plus the folder gestures after the multi-folder selection refactor:
 *   - the folder CHECKBOX toggles the folder PREFIX in the map selection;
 *   - the folder ROW / chevron click is a PURE collapse toggle (no fetch).
 *
 * The isolate scope itself (node + direct neighbors) is covered by
 * `graph-view.spec` and `workspace-view.isolate.spec`; this file only
 * pins the gesture routing at the button vs row level.
 */

const LEAF_PATH = 'readme.md';

function makeNode(path: string, name: string): INodeView {
  return {
    path,
    kind: 'agent',
    frontmatter: { name, description: '', metadata: { version: '1.0.0' } },
  };
}

function makeScan(nodes: INodeView[]): IScanResultApi {
  return {
    schemaVersion: 1,
    scannedAt: 0,
    roots: ['.'],
    providers: [],
    nodes: nodes.map((n) => ({
      path: n.path,
      kind: n.kind,
      provider: 'claude',
      bodyHash: 'h',
      frontmatterHash: 'fh',
      bytes: { frontmatter: 1, body: 1, total: 2 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
    })),
    links: [],
    issues: [],
    stats: {
      filesWalked: nodes.length,
      filesSkipped: 0,
      nodesCount: nodes.length,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
  };
}

function makeLoaderStub(
  nodes: INodeView[],
  counts: Record<string, { errorCount?: number; warnCount?: number }> = {},
) {
  const lite: IFolderNodeLite[] = nodes.map((n) => ({
    path: n.path,
    kind: n.kind,
    linksInCount: 0,
    linksOutCount: 0,
    tokensTotal: null,
    modifiedAtMs: null,
    errorCount: counts[n.path]?.errorCount ?? 0,
    warnCount: counts[n.path]?.warnCount ?? 0,
    sidecarStatus: null,
  }));
  return {
    nodes: signal(nodes),
    scan: signal<IScanResultApi | null>(makeScan(nodes)),
    scanMeta: signal<IScanResultApi | null>(makeScan(nodes)),
    liteNodes: signal<IFolderNodeLite[]>(lite),
    // The files-view builds the tree from `liteNodeViews()`; project the
    // same minimal shape the loader does (path + kind).
    liteNodeViews: signal<INodeView[]>(
      nodes.map((n) => ({ path: n.path, kind: n.kind, frontmatter: { name: '', description: '' } }) as INodeView),
    ),
    corpusCount: signal(nodes.length),
    loading: signal(false),
    error: signal<string | null>(null),
    hasAnyFavorites: signal(false),
    load: vi.fn().mockResolvedValue(undefined),
    toggleFavorite: vi.fn().mockResolvedValue(undefined),
  };
}

/** Minimal stats entry for the Activity-column stub; only `count` matters here. */
function statsOf(count: number): INodeActivityStatsApi {
  return { count, lastStartAt: 0, distinctOwners: 1 };
}

async function bootstrap(
  nodes: INodeView[] = [makeNode(LEAF_PATH, 'readme')],
  counts: Record<string, { errorCount?: number; warnCount?: number }> = {},
  activity: Record<string, number> = {},
): Promise<{
  fixture: ReturnType<typeof TestBed.createComponent<FilesView>>;
  isolate: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  loader: ReturnType<typeof makeLoaderStub>;
  selection: MapVisibilityService;
}> {
  const isolate = vi.fn();
  const open = vi.fn();
  const loader = makeLoaderStub(nodes, counts);
  // The real selection service is `providedIn: 'root'`; clear its
  // localStorage so each test starts from an empty selection.
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: CollectionLoaderService, useValue: loader },
      { provide: MAP_ISOLATE_INTENT, useValue: { isolate } },
      { provide: NODE_OPEN_INTENT, useValue: { open } },
      // FilesView reads `?path` to highlight/reveal the selected node; the
      // rail's follow preference is off by default (localStorage cleared),
      // so a minimal query-param-less route stub is enough here.
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of(convertToParamMap({})),
          snapshot: { queryParamMap: convertToParamMap({}) },
        },
      },
      // The Activity column reads the per-node stats mirror; the real
      // service subscribes to WS streams unavailable here, so tests seed
      // plain signal maps instead (same pattern as inspector-view.spec).
      {
        provide: NodeActivityStatsService,
        useValue: {
          stats: signal<ReadonlyMap<string, INodeActivityStatsApi>>(
            new Map(Object.entries(activity).map(([path, count]) => [path, statsOf(count)])),
          ),
          pairCounts: signal<ReadonlyMap<string, number>>(new Map()),
        } as unknown as NodeActivityStatsService,
      },
    ],
  });
  const selection = TestBed.inject(MapVisibilityService);
  const fixture = TestBed.createComponent(FilesView);
  // Virtualised table: the first render window lands a macrotask later.
  await settleVirtualScroll(fixture);
  return { fixture, isolate, open, loader, selection };
}

/**
 * Throwing on a miss is deliberate. The table is virtualised, so a testid
 * is only in the DOM while its row sits inside the render window; with the
 * handful of rows these specs mount (against a 47-row test window, see
 * `src/test-setup.ts`) every row is present, and a miss is a real failure
 * rather than a windowing artefact.
 */
function query(fixture: ReturnType<typeof TestBed.createComponent<FilesView>>, testid: string): HTMLElement {
  const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    `[data-testid="${testid}"]`,
  );
  if (!el) throw new Error(`missing element [data-testid="${testid}"]`);
  return el;
}

describe('FilesView leaf interactions', () => {
  it('isolate button isolates the chain and does NOT open/select the row', async () => {
    const { fixture, isolate, open } = await bootstrap();

    query(fixture, `files-leaf-graph-${LEAF_PATH}`).click();

    expect(isolate).toHaveBeenCalledWith(LEAF_PATH);
    // The click must NOT bubble to the row's open-intent.
    expect(open).not.toHaveBeenCalled();
  });

  it('row click opens the node in the map (the reference gesture)', async () => {
    const { fixture, isolate, open } = await bootstrap();

    query(fixture, `files-leaf-${LEAF_PATH}`).click();

    expect(open).toHaveBeenCalledWith(LEAF_PATH);
    expect(isolate).not.toHaveBeenCalled();
  });
});

describe('FilesView folder interactions', () => {
  it('folder CHECKBOX toggles the folder prefix in the map selection', async () => {
    const { fixture, selection } = await bootstrap([
      makeNode('src/a.md', 'a'),
      makeNode('src/b.md', 'b'),
    ]);

    // Folder collapsed by default; expand it is not required, the checkbox
    // lives on the folder row itself.
    query(fixture, 'files-vis-folder-src').click();

    // The prefix is added to the selection verbatim (sent to /api/branch).
    expect(new Set(selection.paths())).toEqual(new Set(['src']));

    // Toggling again removes it.
    query(fixture, 'files-vis-folder-src').click();
    expect(selection.paths().size).toBe(0);
  });

  it('folder ROW / chevron click is a PURE collapse toggle (no fetch, no selection change)', async () => {
    const { fixture, loader, selection } = await bootstrap([
      makeNode('src/a.md', 'a'),
      makeNode('src/b.md', 'b'),
    ]);

    query(fixture, 'files-folder-src').click();

    // The chevron only flips the expand state: it never re-fetches the
    // branch and never touches the map selection.
    expect(loader.load).not.toHaveBeenCalled();
    expect(selection.paths().size).toBe(0);
  });

  it('disables descendant checkboxes (checked) when an ancestor folder is selected', async () => {
    const { fixture } = await bootstrap([
      makeNode('src/a.md', 'a'),
      makeNode('src/sub/b.md', 'b'),
      makeNode('src/sub/c.md', 'c'),
    ]);

    // Select the parent prefix, then expand it so the children render.
    query(fixture, 'files-vis-folder-src').click();
    query(fixture, 'files-folder-src').click();
    await settleVirtualScroll(fixture);

    const childFolder = query(fixture, 'files-vis-folder-src/sub') as HTMLButtonElement;
    const childLeaf = query(fixture, 'files-vis-leaf-src/a.md') as HTMLButtonElement;
    const parent = query(fixture, 'files-vis-folder-src') as HTMLButtonElement;

    // Covered by the selected 'src' prefix: shown checked but disabled.
    expect(childFolder.disabled).toBe(true);
    expect(childFolder.getAttribute('data-state')).toBe('all');
    expect(childLeaf.disabled).toBe(true);
    expect(childLeaf.getAttribute('data-state')).toBe('all');
    // The selected parent itself stays enabled (you can uncheck it).
    expect(parent.disabled).toBe(false);
  });

  it('renders the session execution count in the Activity cell and its column header', async () => {
    const { fixture } = await bootstrap(
      [makeNode(LEAF_PATH, 'readme'), makeNode('quiet.md', 'quiet')],
      {},
      { [LEAF_PATH]: 4 },
    );

    // The header exists at its testid regardless of sort state.
    expect(query(fixture, 'files-col-activity')).toBeTruthy();

    const active = (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="files-leaf-${LEAF_PATH}"] .files__cell-activity`,
    );
    const quiet = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="files-leaf-quiet.md"] .files__cell-activity',
    );
    expect(active?.textContent?.trim()).toBe('4');
    // Never-invoked nodes show the missing glyph, not a zero.
    expect(quiet?.textContent?.trim()).toBe('·');
  });

  it('renders rolled-up error / warn badges on the folder row', async () => {
    const { fixture } = await bootstrap(
      [makeNode('src/a.md', 'a'), makeNode('src/b.md', 'b')],
      { 'src/a.md': { errorCount: 2 }, 'src/b.md': { warnCount: 3 } },
    );

    const errors = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="files-folder-errors-src"] .files__issue-count',
    );
    const warns = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="files-folder-warns-src"] .files__issue-count',
    );
    expect(errors?.textContent?.trim()).toBe('2');
    expect(warns?.textContent?.trim()).toBe('3');
  });
});

/**
 * The memoized selection-coverage walk (`selectionCoverage` behind the
 * `coveredByAncestor` / `visibleLeaves` computeds). It replaced per-call
 * `startsWith` scans over the whole selection set, so these tests pin
 * the exact semantics the scans had:
 *   - covered = a SELECTED STRICT ANCESTOR folder exists (never the
 *     path's own selection);
 *   - visible leaf = its exact path is selected OR an ancestor folder is;
 *   - the root pseudo-folder ('') never covers anything.
 * Asserted against the computeds directly (the DOM checkbox states are
 * covered by the folder-interaction tests above).
 */
describe('FilesView selection-coverage computeds', () => {
  interface ICoverageProbe {
    coveredByAncestor(): ReadonlySet<string>;
    visibleLeaves(): ReadonlySet<string>;
  }

  function coverageProbe(
    fixture: ReturnType<typeof TestBed.createComponent<FilesView>>,
  ): ICoverageProbe {
    return fixture.componentInstance as unknown as ICoverageProbe;
  }

  it('an exact leaf selection is visible but never covered', async () => {
    const { fixture, selection } = await bootstrap([
      makeNode('docs/a.md', 'a'),
      makeNode('root.md', 'root'),
    ]);
    const probe = coverageProbe(fixture);

    expect(probe.coveredByAncestor().size).toBe(0);
    expect(probe.visibleLeaves().size).toBe(0);

    selection.toggleLeaf('root.md');
    fixture.detectChanges();

    expect(probe.visibleLeaves().has('root.md')).toBe(true);
    // Its own selection never disables the checkbox.
    expect(probe.coveredByAncestor().has('root.md')).toBe(false);
    // The sibling under a folder is untouched.
    expect(probe.visibleLeaves().has('docs/a.md')).toBe(false);
  });

  it('a selected folder covers its whole subtree but never itself', async () => {
    const { fixture, selection } = await bootstrap([
      makeNode('docs/a.md', 'a'),
      makeNode('docs/sub/b.md', 'b'),
      makeNode('root.md', 'root'),
    ]);
    const probe = coverageProbe(fixture);

    selection.toggleFolder('docs');
    fixture.detectChanges();

    const covered = probe.coveredByAncestor();
    // The selected folder stays toggleable (you can uncheck it).
    expect(covered.has('docs')).toBe(false);
    // Everything strictly below it is covered: leaves AND subfolders.
    expect(covered.has('docs/a.md')).toBe(true);
    expect(covered.has('docs/sub')).toBe(true);
    expect(covered.has('docs/sub/b.md')).toBe(true);
    // Outside the prefix: untouched.
    expect(covered.has('root.md')).toBe(false);

    const visible = probe.visibleLeaves();
    expect(visible.has('docs/a.md')).toBe(true);
    expect(visible.has('docs/sub/b.md')).toBe(true);
    expect(visible.has('root.md')).toBe(false);
  });

  it('a nested folder selection covers only its own branch', async () => {
    const { fixture, selection } = await bootstrap([
      makeNode('docs/a.md', 'a'),
      makeNode('docs/sub/b.md', 'b'),
    ]);
    const probe = coverageProbe(fixture);

    selection.toggleFolder('docs/sub');
    fixture.detectChanges();

    expect(probe.coveredByAncestor().has('docs/sub/b.md')).toBe(true);
    expect(probe.visibleLeaves().has('docs/sub/b.md')).toBe(true);
    // The parent folder and the sibling leaf above the selection: free.
    expect(probe.coveredByAncestor().has('docs')).toBe(false);
    expect(probe.coveredByAncestor().has('docs/a.md')).toBe(false);
    expect(probe.visibleLeaves().has('docs/a.md')).toBe(false);
  });
});
