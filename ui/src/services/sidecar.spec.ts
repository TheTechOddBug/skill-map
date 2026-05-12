import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { EMPTY, Subject } from 'rxjs';

import { SidecarService } from './sidecar';
import { CollectionLoaderService } from './collection-loader';
import {
  DATA_SOURCE,
  DataSourceError,
  type IDataSourcePort,
  type ISidecarBumpOpts,
} from './data-source/data-source.port';
import { WsEventStreamService } from './ws-event-stream';
import type { IWsSidecarBumpedEvent } from '../models/ws-event';
import type { INodeView } from '../models/node';
import type { ISidecarBumpedEnvelopeApi } from '../models/api';

/**
 * Step 9.6.5 — `SidecarService` tests. Covers:
 *   - happy-path delegation to `dataSource.bumpSidecar(...)` with the
 *     expected options shape
 *   - error propagation (DataSourceError surfaces unchanged)
 *   - typed WS subscription patches the in-memory node store on
 *     `sidecar.bumped`
 */

function makeStubLoader(initialNodes: INodeView[] = []): {
  service: CollectionLoaderService;
  patchSpy: ReturnType<typeof vi.fn>;
  nodes: ReturnType<typeof signal<INodeView[]>>;
} {
  const nodes = signal<INodeView[]>(initialNodes);
  const patchSpy = vi.fn((payload: { nodePath: string; version: number | null; status: 'fresh' }) => {
    nodes.update((arr) =>
      arr.map((n) =>
        n.path === payload.nodePath
          ? {
              ...n,
              sidecar: {
                present: true,
                status: payload.status,
                annotations: { version: payload.version ?? undefined },
              },
            }
          : n,
      ),
    );
  });
  const stub = {
    nodes,
    patchSidecarFromBump: patchSpy,
  } as unknown as CollectionLoaderService;
  return { service: stub, patchSpy, nodes };
}

interface IBumpRecord {
  nodePath: string;
  opts: ISidecarBumpOpts;
}

function makeStubDataSource(
  bumpImpl: (nodePath: string, opts: ISidecarBumpOpts) => Promise<ISidecarBumpedEnvelopeApi>,
): { port: IDataSourcePort; calls: IBumpRecord[] } {
  const calls: IBumpRecord[] = [];
  const port = {
    bumpSidecar: vi.fn((nodePath: string, opts: ISidecarBumpOpts = {}) => {
      calls.push({ nodePath, opts });
      return bumpImpl(nodePath, opts);
    }),
    events: () => EMPTY,
  } as unknown as IDataSourcePort;
  return { port, calls };
}

function makeWsStub(
  sidecarBumped$: Subject<IWsSidecarBumpedEvent>,
): WsEventStreamService {
  return {
    events$: EMPTY,
    scanCompleted$: EMPTY,
    sidecarBumped$: sidecarBumped$.asObservable(),
  } as unknown as WsEventStreamService;
}

function envelope(nodePath: string, version: number | null): ISidecarBumpedEnvelopeApi {
  return {
    schemaVersion: '1',
    kind: 'sidecar.bumped',
    value: { nodePath, version, status: 'fresh' },
    elapsedMs: 1,
  };
}

describe('SidecarService — bump()', () => {
  let svc: SidecarService;
  let calls: IBumpRecord[];

  function configure(
    bumpImpl: (nodePath: string, opts: ISidecarBumpOpts) => Promise<ISidecarBumpedEnvelopeApi>,
  ): void {
    const stub = makeStubDataSource(bumpImpl);
    calls = stub.calls;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: DATA_SOURCE, useValue: stub.port },
        { provide: WsEventStreamService, useValue: makeWsStub(new Subject()) },
        { provide: CollectionLoaderService, useValue: makeStubLoader().service },
      ],
    });
    svc = TestBed.inject(SidecarService);
  }

  it('delegates to bumpSidecar with the node path and an empty opts bag', async () => {
    configure((path) => Promise.resolve(envelope(path, 2)));
    const env = await svc.bump('agents/architect.md');
    expect(env.value.version).toBe(2);
    expect(calls).toEqual([{ nodePath: 'agents/architect.md', opts: {} }]);
  });

  it('forwards force=true when supplied', async () => {
    configure((path) => Promise.resolve(envelope(path, 1)));
    await svc.bump('a.md', { force: true });
    expect(calls).toEqual([{ nodePath: 'a.md', opts: { force: true } }]);
  });

  it('forwards confirm=true when supplied (Phase 6 — allowEditSmFiles consent)', async () => {
    configure((path) => Promise.resolve(envelope(path, 1)));
    await svc.bump('a.md', { confirm: true });
    expect(calls).toEqual([{ nodePath: 'a.md', opts: { confirm: true } }]);
  });

  it('propagates a DataSourceError raised by the data source unchanged', async () => {
    const sourceErr = new DataSourceError('confirm-required', 'needs consent', {
      key: 'allowEditSmFiles',
    });
    configure(() => Promise.reject(sourceErr));
    const err = await svc.bump('a.md').catch((e) => e);
    expect(err).toBe(sourceErr);
    expect((err as DataSourceError).code).toBe('confirm-required');
    expect((err as DataSourceError).details).toEqual({ key: 'allowEditSmFiles' });
  });

  it('propagates a sidecar-fresh DataSourceError', async () => {
    const err409 = new DataSourceError('sidecar-fresh', 'fresh');
    configure(() => Promise.reject(err409));
    const err = await svc.bump('a.md').catch((e) => e);
    expect((err as DataSourceError).code).toBe('sidecar-fresh');
  });
});

describe('SidecarService — WS sidecar.bumped subscription', () => {
  let sidecarBumped$: Subject<IWsSidecarBumpedEvent>;
  let stubLoader: ReturnType<typeof makeStubLoader>;

  beforeEach(() => {
    sidecarBumped$ = new Subject<IWsSidecarBumpedEvent>();
    stubLoader = makeStubLoader([
      {
        path: 'agents/architect.md',
        kind: 'agent',
        frontmatter: { name: 'a', description: '', metadata: { version: '1' } },
        sidecar: { present: true, status: 'stale-body', annotations: { version: 1 } },
      },
    ]);
    const dataSourceStub = makeStubDataSource(() =>
      Promise.resolve(envelope('agents/architect.md', 2)),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: DATA_SOURCE, useValue: dataSourceStub.port },
        { provide: WsEventStreamService, useValue: makeWsStub(sidecarBumped$) },
        { provide: CollectionLoaderService, useValue: stubLoader.service },
      ],
    });
    // Eager construction subscribes to sidecarBumped$.
    TestBed.inject(SidecarService);
  });

  afterEach(() => {
    sidecarBumped$.complete();
  });

  it('patches the in-memory node store when a sidecar.bumped event arrives', () => {
    sidecarBumped$.next({
      type: 'sidecar.bumped',
      timestamp: '2026-05-07T00:00:00.000Z',
      data: { nodePath: 'agents/architect.md', version: 2, status: 'fresh' },
    } as unknown as IWsSidecarBumpedEvent);
    expect(stubLoader.patchSpy).toHaveBeenCalledWith({
      nodePath: 'agents/architect.md',
      version: 2,
      status: 'fresh',
    });
    const node = stubLoader.nodes()[0];
    expect(node.sidecar?.status).toBe('fresh');
  });
});
