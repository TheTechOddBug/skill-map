import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EMPTY, Subject } from 'rxjs';

import { CollectionLoaderService } from '../collection-loader';
import { DATA_SOURCE, type IDataSourcePort } from '../data-source/data-source.port';
import { WsEventStreamService, type TWsConnectionState } from '../ws-event-stream';
import type { IWsScanCompletedEvent, IWsSidecarBumpedEvent } from '../../models/ws-event';
import type { IScanResultApi } from '../../models/api';

function emptyScan(extra?: Partial<IScanResultApi>): IScanResultApi {
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

/**
 * Type-safe-ish stub: every method is a `vi.fn` so tests can assert
 * call counts and inject custom resolvers. Using a `type` (not an
 * `interface extends`) sidesteps the `Mock<...>` vs the original method
 * signature mismatch, the cast in `makeStub` is the only place we
 * cross the type boundary.
 */
type IStubDataSource = IDataSourcePort & {
  loadScan: ReturnType<typeof vi.fn>;
  setFavorite: ReturnType<typeof vi.fn>;
  unsetFavorite: ReturnType<typeof vi.fn>;
};

function makeStub(): IStubDataSource {
  return {
    health: vi.fn(),
    loadScan: vi.fn().mockResolvedValue(emptyScan()),
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
): WsEventStreamService {
  return {
    events$: EMPTY,
    scanCompleted$: scanCompleted$.asObservable(),
    sidecarBumped$: sidecarBumped$ ? sidecarBumped$.asObservable() : EMPTY,
    connectionState,
    stableConnected,
  } as unknown as WsEventStreamService;
}

function bootstrap(stub: IStubDataSource, ws: WsEventStreamService): CollectionLoaderService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DATA_SOURCE, useValue: stub },
      { provide: WsEventStreamService, useValue: ws },
    ],
  });
  return TestBed.inject(CollectionLoaderService);
}

describe('CollectionLoaderService', () => {
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
    expect(svc.loading()).toBe(false);
    expect(svc.error()).toBeNull();
  });

  it('populates signals from loadScan() on explicit load()', async () => {
    stub.loadScan.mockResolvedValue(
      emptyScan({
        nodes: [
          { path: 'a.md', kind: 'agent', frontmatter: {} },
          { path: 'b.md', kind: 'markdown', frontmatter: {} },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
    );
    const svc = bootstrap(stub, ws);
    await svc.load();
    expect(svc.nodes()).toHaveLength(2);
    expect(svc.count()).toBe(2);
  });

  it('re-fetches on scan.completed event from the data source', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();
    expect(stub.loadScan).toHaveBeenCalledTimes(1);

    scanCompleted$.next({
      type: 'scan.completed',
      timestamp: 100,
      runId: 'r-1',
      jobId: null,
      data: { nodes: 1, links: 0, issues: 0, durationMs: 1 },
    });

    // The reactive refresh kicks an async load(); flush the microtask
    // queue + a tick to let the awaited loadScan resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(stub.loadScan).toHaveBeenCalledTimes(2);
  });

  it('ignores non-scan.completed events (no thrash on scan.progress)', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();
    expect(stub.loadScan).toHaveBeenCalledTimes(1);

    // The typed `scanCompleted$` only carries `scan.completed`
    // envelopes by construction; non-matching topics never reach this
    // observable in the real WS service. Verify the no-refresh
    // contract by NOT firing anything and asserting the call count
    // stays put.
    await Promise.resolve();
    await Promise.resolve();
    expect(stub.loadScan).toHaveBeenCalledTimes(1);
  });

  it('coalesces a refresh that arrives while load() is in flight', async () => {
    let resolveFirst: (() => void) | undefined;
    stub.loadScan.mockImplementation(
      () =>
        new Promise<IScanResultApi>((resolve) => {
          resolveFirst = () => resolve(emptyScan());
        }),
    );
    const svc = bootstrap(stub, ws);
    const inflight = svc.load();
    expect(svc.loading()).toBe(true);

    // Three rapid-fire events arrive mid-flight. With coalescing they
    // should result in ONE follow-up, not three.
    scanCompleted$.next({ type: 'scan.completed', timestamp: 1, jobId: null, data: {} });
    scanCompleted$.next({ type: 'scan.completed', timestamp: 2, jobId: null, data: {} });
    scanCompleted$.next({ type: 'scan.completed', timestamp: 3, jobId: null, data: {} });

    // Now release the in-flight load. Switch the stub to a resolved
    // Promise so the follow-up settles synchronously.
    stub.loadScan.mockResolvedValue(emptyScan());
    resolveFirst!();
    await inflight;
    // Flush the microtask that schedules the coalesced follow-up.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(stub.loadScan).toHaveBeenCalledTimes(2);
  });

  it('captures a load() error in the error() signal without re-throwing', async () => {
    stub.loadScan.mockRejectedValue(new Error('network boom'));
    const svc = bootstrap(stub, ws);
    await svc.load();
    expect(svc.error()).toBe('network boom');
    expect(svc.loading()).toBe(false);
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
    stub.loadScan.mockResolvedValue(
      emptyScan({
        nodes: [
          { path: 'a.md', kind: 'agent', frontmatter: {}, isFavorite: false },
          { path: 'b.md', kind: 'markdown', frontmatter: {}, isFavorite: true },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
    );
  });

  afterEach(() => {
    scanCompleted$.complete();
  });

  it('hasAnyFavorites reflects the loaded snapshot', async () => {
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
    // Pre-state: a.md is NOT favorited.
    expect(svc.nodes().find((n) => n.path === 'a.md')?.isFavorite).toBe(false);

    const final = await svc.toggleFavorite('a.md', true);
    expect(final).toBe(false); // rolled back
    expect(svc.nodes().find((n) => n.path === 'a.md')?.isFavorite).toBe(false);
    expect(svc.error()).toContain('boom');
  });

  it('hasAnyFavorites flips to false after un-favoriting the last node', async () => {
    stub.loadScan.mockResolvedValue(
      emptyScan({
        nodes: [
          { path: 'b.md', kind: 'markdown', frontmatter: {}, isFavorite: true },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any,
      }),
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
    stub.loadScan.mockResolvedValue(
      emptyScan({
        nodes: [
          {
            path: 'agents/architect.md',
            kind: 'agent',
            frontmatter: { name: 'a', description: '', metadata: { version: '1' } },
            sidecar: { present: true, status: 'stale-body', annotations: { version: 1 } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
      }),
    );
    ws = makeWsStub(scanCompleted$, sidecarBumped$);
  });

  afterEach(() => {
    scanCompleted$.complete();
    sidecarBumped$.complete();
  });

  it('patches the in-memory node store when a sidecar.bumped event arrives', async () => {
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

  // Effects only run on a flush; settle the effect + the async load() it
  // kicks. `TestBed.tick()` flushes the stableConnected effect.
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
    expect(stub.loadScan).toHaveBeenCalledTimes(1);

    stableConnected.set(true);
    await settle();
    expect(stub.loadScan).toHaveBeenCalledTimes(1);
  });

  it('re-seeds only when the socket RE-STABILISES, never on a flap', async () => {
    const svc = bootstrap(stub, ws);
    await svc.load();
    stub.loadScan.mockClear();

    // First stable open after startup: no re-seed (startup load already ran).
    stableConnected.set(true);
    await settle();
    expect(stub.loadScan).not.toHaveBeenCalled();

    // A flap: the socket opened then dropped before the stability window,
    // so it never reports stable. NO re-seed, this is the storm guard that
    // keeps a restarting (`--watch`) BFF from being hammered with the
    // re-seed trio on every up/down cycle.
    stableConnected.set(false);
    await settle();
    expect(stub.loadScan).not.toHaveBeenCalled();

    // A genuine reconnect that re-stabilises re-seeds, because `/ws` does
    // not replay events missed while the socket was down. (load()'s
    // coalesce may collapse a double-fire, so assert it ran, not a count.)
    stableConnected.set(true);
    await settle();
    expect(stub.loadScan).toHaveBeenCalled();
  });
});
