import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EMPTY, Subject } from 'rxjs';

import { CollectionLoaderService } from '../collection-loader';
import { DATA_SOURCE, type IDataSourcePort } from '../data-source/data-source.port';
import { MapVisibilityService } from '../map-visibility';
import { WsEventStreamService, type TWsConnectionState } from '../ws-event-stream';
import type { IWsEvent, IWsScanCompletedEvent, IWsSidecarBumpedEvent } from '../../models/ws-event';
import type {
  IBranchResponseApi,
  IFolderNodeLite,
  INodeApi,
  IScanResultApi,
} from '../../models/api';

/** Debounce the loader uses for the selection-driven fetch (keep in sync). */
const SELECTION_FETCH_DEBOUNCE_MS = 150;

function emptyMeta(extra?: Partial<IScanResultApi>): IScanResultApi {
  return {
    schemaVersion: 1,
    scannedAt: 0,
    roots: ['.'],
    providers: [],
    nodes: [],
    links: [],
    issues: [],
    stats: {
      filesWalked: 0,
      filesSkipped: 0,
      nodesCount: 0,
      linksCount: 0,
      issuesCount: 0,
      durationMs: 0,
    },
    ...extra,
  };
}

function branch(nodes: INodeApi[] = [], paths: string[] = []): IBranchResponseApi {
  return {
    schemaVersion: '1',
    kind: 'branch',
    branch: {
      paths,
      excluded: [],
      rootExcluded: false,
      total: nodes.length,
      rendered: nodes.length,
      truncated: false,
      cap: 256,
    },
    nodes,
    links: [],
    issues: [],
  };
}

/**
 * Type-safe-ish stub: every method is a `vi.fn` so tests can assert
 * call counts and inject custom resolvers. The cast in `makeStub` is the
 * only place we cross the type boundary.
 */
type IStubDataSource = IDataSourcePort & {
  loadScanMeta: ReturnType<typeof vi.fn>;
  loadFolders: ReturnType<typeof vi.fn>;
  loadBranch: ReturnType<typeof vi.fn>;
  setFavorite: ReturnType<typeof vi.fn>;
  unsetFavorite: ReturnType<typeof vi.fn>;
};

function makeStub(): IStubDataSource {
  return {
    health: vi.fn(),
    loadScan: vi.fn(),
    loadScanMeta: vi.fn().mockResolvedValue(emptyMeta()),
    loadFolders: vi.fn().mockResolvedValue([]),
    loadBranch: vi.fn().mockResolvedValue(branch()),
    listNodes: vi.fn(),
    getNode: vi.fn(),
    listLinks: vi.fn(),
    listIssues: vi.fn(),
    loadGraph: vi.fn(),
    loadConfig: vi.fn(),
    listPlugins: vi.fn(),
    setFavorite: vi.fn().mockResolvedValue(undefined),
    unsetFavorite: vi.fn().mockResolvedValue(undefined),
  } as unknown as IStubDataSource;
}

function makeWsStub(
  scanCompleted$: Subject<IWsScanCompletedEvent>,
  sidecarBumped$: Subject<IWsSidecarBumpedEvent> | null = null,
  connectionState: WritableSignal<TWsConnectionState> = signal('connecting'),
  stableConnected: WritableSignal<boolean> = signal(false),
  jobEvents$: Subject<IWsEvent> | null = null,
): WsEventStreamService {
  return {
    events$: EMPTY,
    scanCompleted$: scanCompleted$.asObservable(),
    sidecarBumped$: sidecarBumped$ ? sidecarBumped$.asObservable() : EMPTY,
    // Consumed by the job-completed corpus refresh (fold freshness).
    jobEvents$: jobEvents$ ? jobEvents$.asObservable() : EMPTY,
    connectionState,
    stableConnected,
  } as unknown as WsEventStreamService;
}

function bootstrap(stub: IStubDataSource, ws: WsEventStreamService): CollectionLoaderService {
  // The real `MapVisibilityService` is `providedIn: 'root'` and rehydrates
  // its selection from localStorage; clear it so each loader starts with
  // an empty (whole-corpus) selection.
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DATA_SOURCE, useValue: stub },
      { provide: WsEventStreamService, useValue: ws },
    ],
  });
  return TestBed.inject(CollectionLoaderService);
}

/** Inject the shared selection service the loader watches. */
function selection(): MapVisibilityService {
  return TestBed.inject(MapVisibilityService);
}

describe('CollectionLoaderService, three-fetch lazy boot', () => {
  let stub: IStubDataSource;
  let scanCompleted$: Subject<IWsScanCompletedEvent>;
  let ws: WsEventStreamService;

  beforeEach(() => {
    scanCompleted$ = new Subject<IWsScanCompletedEvent>();
    stub = makeStub();
    ws = makeWsStub(scanCompleted$);
  });

  afterEach(() => {
    scanCompleted$.complete();
  });

  it('exposes empty signals before load() resolves', () => {
    const svc = bootstrap(stub, ws);
    expect(svc.nodes()).toEqual([]);
    expect(svc.scan()).toBeNull();
    expect(svc.scanMeta()).toBeNull();
    expect(svc.liteNodes()).toEqual([]);
    expect(svc.branch()).toBeNull();
    expect(svc.loading()).toBe(false);
    expect(svc.error()).toBeNull();
  });

  it('fires meta + folders + branch in parallel on load()', async () => {
    stub.loadScanMeta.mockResolvedValue(
      emptyMeta({ scanCeiling: 1000, scanTruncated: false, maxRenderNodes: 256 }),
    );
    stub.loadFolders.mockResolvedValue([
      {
        path: 'a.md',
        kind: 'agent',
        linksInCount: 3,
        linksOutCount: 2,
        tokensTotal: 512,
        modifiedAtMs: 1_700_000_000_000,
        errorCount: 0,
        warnCount: 0,
      },
      {
        path: 'b.md',
        kind: 'markdown',
        linksInCount: 0,
        linksOutCount: 0,
        tokensTotal: null,
        modifiedAtMs: null,
        errorCount: 1,
        warnCount: 0,
      },
    ] as IFolderNodeLite[]);
    stub.loadBranch.mockResolvedValue(
      branch([
        { path: 'a.md', kind: 'agent', frontmatter: {} },
      ] as unknown as INodeApi[]),
    );
    const svc = bootstrap(stub, ws);
    await svc.load();

    expect(stub.loadScanMeta).toHaveBeenCalledTimes(1);
    expect(stub.loadFolders).toHaveBeenCalledTimes(1);
    expect(stub.loadBranch).toHaveBeenCalledTimes(1);
    // Boot fetches the union for the current (empty) selection = whole corpus.
    expect(stub.loadBranch).toHaveBeenCalledWith({
      include: [],
      exclude: [],
      excludeRoot: false,
    });

    expect(svc.scanMeta()?.scanCeiling).toBe(1000);
    expect(svc.liteNodes()).toHaveLength(2);
    expect(svc.corpusCount()).toBe(2);
    expect(svc.nodes()).toHaveLength(1);
    expect(svc.count()).toBe(1);
  });

  it('projects the lite item scalar columns through liteNodeViews()', async () => {
    stub.loadFolders.mockResolvedValue([
      {
        path: 'a.md',
        kind: 'agent',
        linksInCount: 3,
        linksOutCount: 2,
        tokensTotal: 512,
        modifiedAtMs: 1_700_000_000_000,
        errorCount: 0,
        warnCount: 0,
      },
      {
        path: 'b.md',
        kind: 'markdown',
        linksInCount: 0,
        linksOutCount: 0,
        tokensTotal: null,
        modifiedAtMs: null,
        errorCount: 0,
        warnCount: 0,
      },
    ] as IFolderNodeLite[]);
    const svc = bootstrap(stub, ws);
    await svc.load();

    const views = svc.liteNodeViews();
    const withData = views.find((v) => v.path === 'a.md');
    expect(withData?.linksInCount).toBe(3);
    expect(withData?.linksOutCount).toBe(2);
    expect(withData?.tokensTotal).toBe(512);
    expect(withData?.modifiedAtMs).toBe(1_700_000_000_000);

    // Nullable wire fields coerce to `undefined` on the view.
    const withoutData = views.find((v) => v.path === 'b.md');
    expect(withoutData?.linksInCount).toBe(0);
    expect(withoutData?.linksOutCount).toBe(0);
    expect(withoutData?.tokensTotal).toBeUndefined();
    expect(withoutData?.modifiedAtMs).toBeUndefined();
  });

  it('scan() is branch-scoped: meta scalars fused with branch payload', async () => {
    stub.loadScanMeta.mockResolvedValue(emptyMeta({ roots: ['/proj'] }));
    stub.loadBranch.mockResolvedValue({
      ...branch([{ path: 'a.md', kind: 'agent', frontmatter: {} }] as unknown as INodeApi[]),
      links: [{ source: 'a.md', target: 'b.md', kind: 'references', confidence: 1, sources: [] }],
      issues: [{ analyzerId: 'x', severity: 'error', nodeIds: ['a.md'], message: 'm' }],
    });
    const svc = bootstrap(stub, ws);
    await svc.load();
    const scan = svc.scan();
    expect(scan?.roots).toEqual(['/proj']);
    expect(scan?.nodes).toHaveLength(1);
    expect(scan?.links).toHaveLength(1);
    expect(scan?.issues).toHaveLength(1);
  });

  it('re-fires all three fetches on a scan.completed event', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();
    expect(stub.loadScanMeta).toHaveBeenCalledTimes(1);

    scanCompleted$.next({
      type: 'scan.completed',
      timestamp: 100,
      runId: 'r-1',
      jobId: null,
      data: { nodes: 1, links: 0, issues: 0, durationMs: 1 },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(stub.loadScanMeta).toHaveBeenCalledTimes(2);
    expect(stub.loadFolders).toHaveBeenCalledTimes(2);
    expect(stub.loadBranch).toHaveBeenCalledTimes(2);
  });

  it('refreshes the corpus on job.completed, debounced (fold freshness, user report 2026-07-22)', async () => {
    // A completed job lands findings whose severity fold rides the node
    // corpus; without this refresh the card counters lag until an F5.
    vi.useFakeTimers();
    try {
      const jobEvents$ = new Subject<IWsEvent>();
      const svc = bootstrap(stub, makeWsStub(scanCompleted$, null, undefined, undefined, jobEvents$));
      await svc.load();
      expect(stub.loadScanMeta).toHaveBeenCalledTimes(1);

      // A burst of records (an ALL run draining) coalesces into ONE reload.
      jobEvents$.next({ type: 'job.completed', timestamp: 1, jobId: 'j-1', data: {} } as IWsEvent);
      jobEvents$.next({ type: 'job.completed', timestamp: 2, jobId: 'j-2', data: {} } as IWsEvent);
      // A non-completed lifecycle frame alone must NOT refresh.
      jobEvents$.next({ type: 'job.claimed', timestamp: 3, jobId: 'j-3', data: {} } as IWsEvent);

      await vi.advanceTimersByTimeAsync(499);
      expect(stub.loadScanMeta).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(stub.loadScanMeta).toHaveBeenCalledTimes(2);
      expect(stub.loadBranch).toHaveBeenCalledTimes(2);

      // The claimed frame's own debounce window elapsed with no
      // completion behind it: no third reload.
      await vi.advanceTimersByTimeAsync(1000);
      expect(stub.loadScanMeta).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces a refresh that arrives while load() is in flight', async () => {
    let resolveFirst: (() => void) | undefined;
    stub.loadScanMeta.mockImplementation(
      () =>
        new Promise<IScanResultApi>((resolve) => {
          resolveFirst = () => resolve(emptyMeta());
        }),
    );
    const svc = bootstrap(stub, ws);
    const inflight = svc.load();
    expect(svc.loading()).toBe(true);

    scanCompleted$.next({ type: 'scan.completed', timestamp: 1, jobId: null, data: {} });
    scanCompleted$.next({ type: 'scan.completed', timestamp: 2, jobId: null, data: {} });
    scanCompleted$.next({ type: 'scan.completed', timestamp: 3, jobId: null, data: {} });

    stub.loadScanMeta.mockResolvedValue(emptyMeta());
    resolveFirst!();
    await inflight;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // One boot load + exactly one coalesced follow-up = 2 total.
    expect(stub.loadScanMeta).toHaveBeenCalledTimes(2);
  });

  it('captures a load() error in the error() signal without re-throwing', async () => {
    stub.loadFolders.mockRejectedValue(new Error('network boom'));
    const svc = bootstrap(stub, ws);
    await svc.load();
    expect(svc.error()).toBe('network boom');
    expect(svc.loading()).toBe(false);
  });
});

describe('CollectionLoaderService, selection-driven branch fetch', () => {
  let stub: IStubDataSource;
  let scanCompleted$: Subject<IWsScanCompletedEvent>;
  let ws: WsEventStreamService;

  beforeEach(() => {
    vi.useFakeTimers();
    scanCompleted$ = new Subject<IWsScanCompletedEvent>();
    stub = makeStub();
    ws = makeWsStub(scanCompleted$);
  });

  afterEach(() => {
    scanCompleted$.complete();
    vi.useRealTimers();
  });

  /** Flush the loader's async branch fetch (one microtask round). */
  async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it('boot fetches the scope for the current (seeded, legacy-migrated) selection', async () => {
    // Seed a LEGACY selection BEFORE the loader boots: the storage
    // migration converts it to root-exclude + include, and load() sends
    // that scope on the wire.
    localStorage.setItem('sm.map.visible-paths', JSON.stringify(['src']));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: DATA_SOURCE, useValue: stub },
        { provide: WsEventStreamService, useValue: ws },
      ],
    });
    const svc = TestBed.inject(CollectionLoaderService);
    await svc.load();
    expect(stub.loadBranch).toHaveBeenCalledTimes(1);
    expect(stub.loadBranch).toHaveBeenCalledWith({
      include: ['src'],
      exclude: [],
      excludeRoot: true,
    });
  });

  it('debounce-fetches the branch when the overrides change (one fetch per burst)', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();
    expect(stub.loadBranch).toHaveBeenCalledTimes(1); // boot

    stub.loadBranch.mockResolvedValue(
      branch([{ path: 'src/x.md', kind: 'agent', frontmatter: {} }] as unknown as INodeApi[], ['src']),
    );

    const sel = selection();
    // A burst of three toggles before the debounce fires.
    sel.setSubtree('src', 'exclude');
    sel.setSubtree('docs', 'exclude');
    sel.setSubtree('docs', 'include'); // toggles docs back to inherited
    TestBed.tick(); // run the selection effect(s)

    // Debounce not elapsed yet: still only the boot fetch.
    expect(stub.loadBranch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SELECTION_FETCH_DEBOUNCE_MS);
    await flush();

    // Exactly one coalesced fetch with the final scope (only src excluded).
    expect(stub.loadBranch).toHaveBeenCalledTimes(2);
    expect(stub.loadBranch).toHaveBeenLastCalledWith({
      include: [],
      exclude: ['src'],
      excludeRoot: false,
    });
    expect(svc.nodes()).toHaveLength(1);
    expect(svc.nodes()[0]?.path).toBe('src/x.md');
    // Meta + folders are NOT re-fetched on a scope change.
    expect(stub.loadScanMeta).toHaveBeenCalledTimes(1);
    expect(stub.loadFolders).toHaveBeenCalledTimes(1);
  });

  it('sends the full override scope on the wire (includes + excludes + root)', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();

    const sel = selection();
    sel.setOnly(['src', 'docs']);
    TestBed.tick();
    vi.advanceTimersByTime(SELECTION_FETCH_DEBOUNCE_MS);
    await flush();

    // Include order = selection order (seniority), not sorted.
    expect(stub.loadBranch).toHaveBeenLastCalledWith({
      include: ['src', 'docs'],
      exclude: [],
      excludeRoot: true,
    });
    void svc;
  });

  it('an include reorder (same set, new seniority) refetches the branch', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();

    const sel = selection();
    sel.setOnly(['src', 'docs']);
    TestBed.tick();
    vi.advanceTimersByTime(SELECTION_FETCH_DEBOUNCE_MS);
    await flush();
    const callsAfterFirst = stub.loadBranch.mock.calls.length;

    sel.setOnly(['docs', 'src']);
    TestBed.tick();
    vi.advanceTimersByTime(SELECTION_FETCH_DEBOUNCE_MS);
    await flush();

    expect(stub.loadBranch.mock.calls.length).toBe(callsAfterFirst + 1);
    expect(stub.loadBranch).toHaveBeenLastCalledWith({
      include: ['docs', 'src'],
      exclude: [],
      excludeRoot: true,
    });
    void svc;
  });

  it('does not fetch on the initial effect tick (boot already covers it)', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();
    // The selection effect ran once at construction; only the boot fetch fired.
    TestBed.tick();
    vi.advanceTimersByTime(SELECTION_FETCH_DEBOUNCE_MS);
    await flush();
    expect(stub.loadBranch).toHaveBeenCalledTimes(1);
    void svc;
  });
});

describe('CollectionLoaderService, favorites', () => {
  let stub: IStubDataSource;
  let scanCompleted$: Subject<IWsScanCompletedEvent>;
  let ws: WsEventStreamService;

  beforeEach(() => {
    scanCompleted$ = new Subject<IWsScanCompletedEvent>();
    stub = makeStub();
    ws = makeWsStub(scanCompleted$);
    stub.loadBranch.mockResolvedValue(
      branch([
        { path: 'a.md', kind: 'agent', frontmatter: {}, isFavorite: false },
        { path: 'b.md', kind: 'markdown', frontmatter: {}, isFavorite: true },
      ] as unknown as INodeApi[]),
    );
  });

  afterEach(() => {
    scanCompleted$.complete();
  });

  it('hasAnyFavorites reflects the loaded branch', async () => {
    const svc = bootstrap(stub, ws);
    expect(svc.hasAnyFavorites()).toBe(false);
    await svc.load();
    expect(svc.hasAnyFavorites()).toBe(true);
  });

  it('toggleFavorite(true) flips local state and calls setFavorite', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();
    const final = await svc.toggleFavorite('a.md', true);
    expect(final).toBe(true);
    expect(svc.nodes().find((n) => n.path === 'a.md')?.isFavorite).toBe(true);
    expect(stub.setFavorite).toHaveBeenCalledWith('a.md');
    expect(stub.unsetFavorite).not.toHaveBeenCalled();
  });

  it('toggleFavorite(false) calls unsetFavorite', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();
    const final = await svc.toggleFavorite('b.md', false);
    expect(final).toBe(false);
    expect(svc.nodes().find((n) => n.path === 'b.md')?.isFavorite).toBe(false);
    expect(stub.unsetFavorite).toHaveBeenCalledWith('b.md');
  });

  it('rolls back the optimistic flip when the BFF call fails', async () => {
    stub.setFavorite.mockRejectedValue(new Error('boom'));
    const svc = bootstrap(stub, ws);
    await svc.load();
    expect(svc.nodes().find((n) => n.path === 'a.md')?.isFavorite).toBe(false);

    const final = await svc.toggleFavorite('a.md', true);
    expect(final).toBe(false); // rolled back
    expect(svc.nodes().find((n) => n.path === 'a.md')?.isFavorite).toBe(false);
    expect(svc.error()).toContain('boom');
  });

  it('hasAnyFavorites flips to false after un-favoriting the last node', async () => {
    stub.loadBranch.mockResolvedValue(
      branch([
        { path: 'b.md', kind: 'markdown', frontmatter: {}, isFavorite: true },
      ] as unknown as INodeApi[]),
    );
    const svc = bootstrap(stub, ws);
    await svc.load();
    expect(svc.hasAnyFavorites()).toBe(true);
    await svc.toggleFavorite('b.md', false);
    expect(svc.hasAnyFavorites()).toBe(false);
  });
});

describe('CollectionLoaderService, sidecar.bumped subscription', () => {
  let stub: IStubDataSource;
  let scanCompleted$: Subject<IWsScanCompletedEvent>;
  let sidecarBumped$: Subject<IWsSidecarBumpedEvent>;
  let ws: WsEventStreamService;

  beforeEach(() => {
    scanCompleted$ = new Subject<IWsScanCompletedEvent>();
    sidecarBumped$ = new Subject<IWsSidecarBumpedEvent>();
    stub = makeStub();
    stub.loadBranch.mockResolvedValue(
      branch([
        {
          path: 'agents/architect.md',
          kind: 'agent',
          frontmatter: { name: 'a', description: '' },
          sidecar: { present: true, status: 'stale-body', annotations: { version: 1 } },
        },
      ] as unknown as INodeApi[]),
    );
    ws = makeWsStub(scanCompleted$, sidecarBumped$);
  });

  afterEach(() => {
    scanCompleted$.complete();
    sidecarBumped$.complete();
  });

  it('patches the in-memory branch store when a sidecar.bumped event arrives', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();
    sidecarBumped$.next({
      type: 'sidecar.bumped',
      timestamp: '2026-05-07T00:00:00.000Z',
      data: { nodePath: 'agents/architect.md', version: 2, status: 'fresh' },
    } as unknown as IWsSidecarBumpedEvent);
    const node = svc.nodes().find((n) => n.path === 'agents/architect.md');
    expect(node?.sidecar?.status).toBe('fresh');
    expect(node?.sidecar?.annotations?.['version']).toBe(2);
  });
});

describe('CollectionLoaderService, re-seed on reconnect', () => {
  let stub: IStubDataSource;
  let scanCompleted$: Subject<IWsScanCompletedEvent>;
  let stableConnected: WritableSignal<boolean>;
  let ws: WsEventStreamService;

  async function settle(): Promise<void> {
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    scanCompleted$ = new Subject<IWsScanCompletedEvent>();
    stableConnected = signal(false);
    stub = makeStub();
    ws = makeWsStub(scanCompleted$, null, signal<TWsConnectionState>('connecting'), stableConnected);
  });

  afterEach(() => {
    scanCompleted$.complete();
  });

  it('does NOT re-seed on the first stable open (startup load already covers it)', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();
    expect(stub.loadScanMeta).toHaveBeenCalledTimes(1);

    stableConnected.set(true);
    await settle();
    expect(stub.loadScanMeta).toHaveBeenCalledTimes(1);
  });

  it('re-seeds only when the socket RE-STABILISES, never on a flap', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();
    stub.loadScanMeta.mockClear();

    stableConnected.set(true);
    await settle();
    expect(stub.loadScanMeta).not.toHaveBeenCalled();

    stableConnected.set(false);
    await settle();
    expect(stub.loadScanMeta).not.toHaveBeenCalled();

    stableConnected.set(true);
    await settle();
    expect(stub.loadScanMeta).toHaveBeenCalled();
  });
});
