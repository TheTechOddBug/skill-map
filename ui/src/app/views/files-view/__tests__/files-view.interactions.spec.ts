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
import { ProjectIgnoreService } from '../../../../services/project-ignore';
import { MapViewsService } from '../../../../services/map-views';
import { LiveLensService } from '../../../../services/live-lens';
import { UsageTrackerService } from '../../../services/usage-tracker';
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
  ignoreAvailable = true,
): Promise<{
  fixture: ReturnType<typeof TestBed.createComponent<FilesView>>;
  isolate: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  requestIgnore: ReturnType<typeof vi.fn>;
  clearError: ReturnType<typeof vi.fn>;
  trackFeature: ReturnType<typeof vi.fn>;
  ignoreErrorText: ReturnType<typeof signal<string | null>>;
  loader: ReturnType<typeof makeLoaderStub>;
  selection: MapVisibilityService;
}> {
  const isolate = vi.fn();
  const open = vi.fn();
  const requestIgnore = vi.fn().mockResolvedValue('dialog');
  const clearError = vi.fn();
  const trackFeature = vi.fn();
  const ignoreErrorText = signal<string | null>(null);
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
      // Live lens owner: stubbed OFF so the rail keeps its whole-corpus
      // listing (the lens narrows it to the executed set) and construction
      // never reaches DATA_SOURCE / SKILL_MAP_MODE through its graph.
      {
        provide: LiveLensService,
        useValue: {
          active: signal(false).asReadonly(),
          membership: signal<ReadonlySet<string>>(new Set()).asReadonly(),
        } as unknown as LiveLensService,
      },
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
      // Ignore-gesture owner: stubbed so the specs drive the disposition
      // and no DATA_SOURCE / SKILL_MAP_MODE token is ever needed.
      {
        provide: ProjectIgnoreService,
        useValue: {
          available: signal(ignoreAvailable).asReadonly(),
          errorText: ignoreErrorText.asReadonly(),
          requestIgnore,
          clearError,
        } as unknown as ProjectIgnoreService,
      },
      // Map-views owner: stubbed neutral (no active view) so the
      // provenance chip stays hidden and no DATA_SOURCE token is needed.
      {
        provide: MapViewsService,
        useValue: {
          available: signal(true).asReadonly(),
          activeView: signal(null).asReadonly(),
          dirty: signal(false).asReadonly(),
          requestOpenSwitcher: () => undefined,
        } as unknown as MapViewsService,
      },
      { provide: UsageTrackerService, useValue: { trackFeature } },
    ],
  });
  const selection = TestBed.inject(MapVisibilityService);
  const fixture = TestBed.createComponent(FilesView);
  // Virtualised table: the first render window lands a macrotask later.
  await settleVirtualScroll(fixture);
  return {
    fixture,
    isolate,
    open,
    requestIgnore,
    clearError,
    trackFeature,
    ignoreErrorText,
    loader,
    selection,
  };
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

  it('ignore button requests the file ignore and does NOT open the row', async () => {
    const { fixture, open, requestIgnore } = await bootstrap();

    query(fixture, `files-ignore-leaf-${LEAF_PATH}`).click();

    expect(requestIgnore).toHaveBeenCalledWith(LEAF_PATH, 'file', 'files');
    // The click must NOT bubble to the row's open-intent.
    expect(open).not.toHaveBeenCalled();
  });

  it('hides the ignore buttons while the service reports unavailable (demo)', async () => {
    const { fixture } = await bootstrap(
      [makeNode(LEAF_PATH, 'readme')],
      {},
      {},
      false,
    );

    const el = (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="files-ignore-leaf-${LEAF_PATH}"]`,
    );
    expect(el).toBeNull();
  });

  it('emits the auto telemetry when the suppressed path skips the dialog', async () => {
    const { fixture, requestIgnore, trackFeature } = await bootstrap();
    requestIgnore.mockResolvedValue('auto');

    query(fixture, `files-ignore-leaf-${LEAF_PATH}`).click();
    // The outcome resolves a microtask later; the emit rides its .then.
    await Promise.resolve();
    await Promise.resolve();

    expect(trackFeature).toHaveBeenCalledWith('ignore-path', 'auto', 'files');
  });

  it('a dialog outcome emits NO call-site telemetry (the dialog owns it)', async () => {
    const { fixture, trackFeature } = await bootstrap();

    query(fixture, `files-ignore-leaf-${LEAF_PATH}`).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(trackFeature).not.toHaveBeenCalled();
  });

  it('surfaces the write failure as a closable message wired to clearError', async () => {
    const { fixture, clearError, ignoreErrorText } = await bootstrap();

    ignoreErrorText.set('disk full');
    await settleVirtualScroll(fixture);

    const msg = query(fixture, 'files-ignore-error');
    expect(msg.textContent).toContain('disk full');

    // PrimeNG renders the close affordance as a button inside the host.
    const close = msg.querySelector<HTMLButtonElement>('button');
    expect(close).not.toBeNull();
    close!.click();
    expect(clearError).toHaveBeenCalledTimes(1);
  });
});

describe('FilesView folder interactions', () => {
  it('folder CHECKBOX toggles an exclude override for the subtree (starts checked)', async () => {
    const { fixture, selection } = await bootstrap([
      makeNode('src/a.md', 'a'),
      makeNode('src/b.md', 'b'),
    ]);

    // Every checkbox starts CHECKED (deviation model: no overrides =
    // everything visible).
    const box = query(fixture, 'files-vis-folder-src') as HTMLButtonElement;
    expect(box.getAttribute('data-state')).toBe('all');

    // Unchecking writes ONE exclude override for the subtree.
    box.click();
    expect(selection.overrides().get('src')).toBe('exclude');

    // Re-checking deletes it (canonical map, back to show-all).
    query(fixture, 'files-vis-folder-src').click();
    expect(selection.overrides().size).toBe(0);
  });

  it('folder ROW / chevron click is a PURE collapse toggle (no fetch, no override change)', async () => {
    const { fixture, loader, selection } = await bootstrap([
      makeNode('src/a.md', 'a'),
      makeNode('src/b.md', 'b'),
    ]);

    query(fixture, 'files-folder-src').click();

    // The chevron only flips the expand state: it never re-fetches the
    // branch and never touches the overrides.
    expect(loader.load).not.toHaveBeenCalled();
    expect(selection.overrides().size).toBe(0);
  });

  it('folder ignore button requests the subtree ignore and does NOT collapse the folder', async () => {
    const { fixture, loader, requestIgnore } = await bootstrap([
      makeNode('src/a.md', 'a'),
      makeNode('src/b.md', 'b'),
    ]);

    // Folders start collapsed: expand first so the children render and
    // an accidental collapse (a bubbled row click) becomes observable.
    query(fixture, 'files-folder-src').click();
    await settleVirtualScroll(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="files-leaf-src/a.md"]',
      ),
    ).not.toBeNull();

    query(fixture, 'files-ignore-folder-src').click();
    await settleVirtualScroll(fixture);

    expect(requestIgnore).toHaveBeenCalledWith('src', 'folder', 'files');
    // stopPropagation: the row's collapse toggle must not also run, so
    // the folder's children remain rendered.
    expect(loader.load).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="files-leaf-src/a.md"]',
      ),
    ).not.toBeNull();
  });

  it('descendant checkboxes stay TOGGLEABLE under an excluded ancestor (deeper override)', async () => {
    const { fixture, selection } = await bootstrap([
      makeNode('src/a.md', 'a'),
      makeNode('src/sub/b.md', 'b'),
      makeNode('src/sub/c.md', 'c'),
    ]);

    // Exclude the parent, then expand it so the children render.
    query(fixture, 'files-vis-folder-src').click();
    query(fixture, 'files-folder-src').click();
    await settleVirtualScroll(fixture);

    const childFolder = query(fixture, 'files-vis-folder-src/sub') as HTMLButtonElement;
    const childLeaf = query(fixture, 'files-vis-leaf-src/a.md') as HTMLButtonElement;

    // The subtree inherits the exclusion (unchecked), but nothing is
    // disabled: the covered-by-ancestor state died with the include set.
    expect(childFolder.disabled).toBe(false);
    expect(childFolder.getAttribute('data-state')).toBe('none');
    expect(childLeaf.disabled).toBe(false);
    expect(childLeaf.getAttribute('data-state')).toBe('none');

    // Checking a child under the excluded parent writes a deeper
    // include override (the rescue), never touching the parent's.
    childLeaf.click();
    expect(selection.overrides().get('src')).toBe('exclude');
    expect(selection.overrides().get('src/a.md')).toBe('include');
  });

  it('a mixed folder clicks to fully visible (indeterminate -> checked)', async () => {
    const { fixture, selection } = await bootstrap([
      makeNode('src/a.md', 'a'),
      makeNode('src/sub/b.md', 'b'),
    ]);

    // Exclude a child so the parent reads mixed.
    query(fixture, 'files-folder-src').click();
    await settleVirtualScroll(fixture);
    query(fixture, 'files-vis-leaf-src/a.md').click();
    fixture.detectChanges();
    const parent = query(fixture, 'files-vis-folder-src') as HTMLButtonElement;
    expect(parent.getAttribute('data-state')).toBe('some');

    // The mixed parent clicks to ALL VISIBLE (native tri-state
    // convention), wiping the child's exclude.
    parent.click();
    expect(selection.overrides().size).toBe(0);
  });

  it('the master header checkbox toggles the root override', async () => {
    // Two leaves per folder: a single-child folder chain compacts into a
    // prefixed leaf row, and this test needs a real `src` folder row.
    const { fixture, selection } = await bootstrap([
      makeNode('src/a.md', 'a'),
      makeNode('src/b.md', 'b'),
      makeNode('docs/c.md', 'c'),
      makeNode('docs/d.md', 'd'),
    ]);

    const master = query(fixture, 'files-vis-root') as HTMLButtonElement;
    expect(master.getAttribute('data-state')).toBe('all');

    master.click();
    expect(selection.overrides().get('')).toBe('exclude');
    fixture.detectChanges();
    expect(master.getAttribute('data-state')).toBe('none');

    // Master-uncheck + check one folder = the curation workflow.
    await settleVirtualScroll(fixture);
    query(fixture, 'files-vis-folder-src').click();
    expect(selection.overrides().get('src')).toBe('include');
    fixture.detectChanges();
    expect(master.getAttribute('data-state')).toBe('some');
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
describe('FilesView effective-state computeds', () => {
  interface IWalkProbe {
    folderStateMap(): Map<string, 'all' | 'some' | 'none'>;
    visibleLeaves(): ReadonlySet<string>;
    rootState(): 'all' | 'some' | 'none';
  }

  function walkProbe(
    fixture: ReturnType<typeof TestBed.createComponent<FilesView>>,
  ): IWalkProbe {
    return fixture.componentInstance as unknown as IWalkProbe;
  }

  it('everything visible by default; a leaf exclude flips only that leaf', async () => {
    const { fixture, selection } = await bootstrap([
      makeNode('docs/a.md', 'a'),
      makeNode('root.md', 'root'),
    ]);
    const probe = walkProbe(fixture);

    expect(probe.visibleLeaves().has('docs/a.md')).toBe(true);
    expect(probe.visibleLeaves().has('root.md')).toBe(true);
    expect(probe.rootState()).toBe('all');

    selection.setSubtree('root.md', 'exclude');
    fixture.detectChanges();

    expect(probe.visibleLeaves().has('root.md')).toBe(false);
    expect(probe.visibleLeaves().has('docs/a.md')).toBe(true);
    expect(probe.rootState()).toBe('some');
    expect(probe.folderStateMap().get('docs')).toBe('all');
  });

  it('an excluded folder reads none and hides its whole subtree', async () => {
    const { fixture, selection } = await bootstrap([
      makeNode('docs/a.md', 'a'),
      makeNode('docs/sub/b.md', 'b'),
      makeNode('root.md', 'root'),
    ]);
    const probe = walkProbe(fixture);

    selection.setSubtree('docs', 'exclude');
    fixture.detectChanges();

    expect(probe.folderStateMap().get('docs')).toBe('none');
    expect(probe.folderStateMap().get('docs/sub')).toBe('none');
    expect(probe.visibleLeaves().has('docs/a.md')).toBe(false);
    expect(probe.visibleLeaves().has('docs/sub/b.md')).toBe(false);
    expect(probe.visibleLeaves().has('root.md')).toBe(true);
    expect(probe.rootState()).toBe('some');
  });

  it('a deeper include under an exclude reads mixed on the ancestor (nearest wins)', async () => {
    const { fixture, selection } = await bootstrap([
      makeNode('docs/a.md', 'a'),
      makeNode('docs/sub/b.md', 'b'),
    ]);
    const probe = walkProbe(fixture);

    selection.setSubtree('docs', 'exclude');
    selection.setSubtree('docs/sub', 'include');
    fixture.detectChanges();

    expect(probe.folderStateMap().get('docs')).toBe('some');
    expect(probe.folderStateMap().get('docs/sub')).toBe('all');
    expect(probe.visibleLeaves().has('docs/sub/b.md')).toBe(true);
    expect(probe.visibleLeaves().has('docs/a.md')).toBe(false);
  });
});
