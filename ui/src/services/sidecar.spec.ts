import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';

import { SidecarService } from './sidecar';
import { CollectionLoaderService } from './collection-loader';
import { DATA_SOURCE, DataSourceError, type IDataSourcePort } from './data-source/data-source.port';
import type { IWsEvent } from '../models/ws-event';
import type { INodeView } from '../models/node';

/**
 * Step 9.6.5 — `SidecarService` tests. Covers:
 *   - happy-path POST to `/api/sidecar/bump` with the expected body shape
 *   - error translation (sidecar-fresh, not-found, transport)
 *   - WS subscription patches the in-memory node store on `sidecar.bumped`
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

function makeStubDataSource(events$: Subject<IWsEvent>): IDataSourcePort {
  return {
    health: vi.fn(),
    loadScan: vi.fn(),
    listNodes: vi.fn(),
    getNode: vi.fn(),
    listLinks: vi.fn(),
    listIssues: vi.fn(),
    loadGraph: vi.fn(),
    loadConfig: vi.fn(),
    listPlugins: vi.fn(),
    events: vi.fn().mockReturnValue(events$.asObservable()),
  } as unknown as IDataSourcePort;
}

describe('SidecarService — bump()', () => {
  let httpMock: HttpTestingController;
  let svc: SidecarService;
  let events$: Subject<IWsEvent>;

  beforeEach(() => {
    events$ = new Subject<IWsEvent>();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DATA_SOURCE, useValue: makeStubDataSource(events$) },
        { provide: CollectionLoaderService, useValue: makeStubLoader().service },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(SidecarService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('POSTs to /api/sidecar/bump with the expected body and returns the envelope', async () => {
    const promise = svc.bump('agents/architect.md');
    const req = httpMock.expectOne('/api/sidecar/bump');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ nodePath: 'agents/architect.md' });
    req.flush({
      schemaVersion: '1',
      kind: 'sidecar.bumped',
      value: { nodePath: 'agents/architect.md', version: 2, status: 'fresh' },
      elapsedMs: 5,
    });
    const env = await promise;
    expect(env.value.version).toBe(2);
  });

  it('forwards force=true when supplied', async () => {
    const promise = svc.bump('a.md', { force: true });
    const req = httpMock.expectOne('/api/sidecar/bump');
    expect(req.request.body).toEqual({ nodePath: 'a.md', force: true });
    req.flush({
      schemaVersion: '1',
      kind: 'sidecar.bumped',
      value: { nodePath: 'a.md', version: 1, status: 'fresh' },
      elapsedMs: 1,
    });
    await promise;
  });

  it('does NOT forward `reason` (catalog curation 2026-05-07 dropped it)', async () => {
    // The bump options interface no longer carries `reason`; even if a
    // caller bypasses the type via `as any`, the runtime body must
    // contain only the curated keys.
    const promise = svc.bump('a.md', { force: true } as { force: true });
    const req = httpMock.expectOne('/api/sidecar/bump');
    expect(req.request.body).not.toHaveProperty('reason');
    req.flush({
      schemaVersion: '1',
      kind: 'sidecar.bumped',
      value: { nodePath: 'a.md', version: 1, status: 'fresh' },
      elapsedMs: 1,
    });
    await promise;
  });

  it('translates a 409 sidecar-fresh response to a DataSourceError with code sidecar-fresh', async () => {
    const promise = svc.bump('a.md').catch((e) => e);
    const req = httpMock.expectOne('/api/sidecar/bump');
    req.flush(
      { ok: false, error: { code: 'sidecar-fresh', message: 'fresh' } },
      { status: 409, statusText: 'Conflict' },
    );
    const err = await promise;
    expect(err).toBeInstanceOf(DataSourceError);
    expect((err as DataSourceError).code).toBe('sidecar-fresh');
  });

  it('translates a 404 not-found response to a DataSourceError with code not-found', async () => {
    const promise = svc.bump('missing.md').catch((e) => e);
    const req = httpMock.expectOne('/api/sidecar/bump');
    req.flush(
      { ok: false, error: { code: 'not-found', message: 'not found' } },
      { status: 404, statusText: 'Not Found' },
    );
    const err = await promise;
    expect(err).toBeInstanceOf(DataSourceError);
    expect((err as DataSourceError).code).toBe('not-found');
  });

  it('falls back to internal on a transport-level failure with no envelope', async () => {
    const promise = svc.bump('a.md').catch((e) => e);
    const req = httpMock.expectOne('/api/sidecar/bump');
    req.flush('boom', { status: 500, statusText: 'Internal Server Error' });
    const err = await promise;
    expect(err).toBeInstanceOf(DataSourceError);
    expect((err as DataSourceError).code).toBe('internal');
  });
});

describe('SidecarService — WS sidecar.bumped subscription', () => {
  let events$: Subject<IWsEvent>;
  let stubLoader: ReturnType<typeof makeStubLoader>;

  beforeEach(() => {
    events$ = new Subject<IWsEvent>();
    stubLoader = makeStubLoader([
      {
        path: 'agents/architect.md',
        kind: 'agent',
        frontmatter: { name: 'a', description: '', metadata: { version: '1' } },
        sidecar: { present: true, status: 'stale-body', annotations: { version: 1 } },
      },
    ]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DATA_SOURCE, useValue: makeStubDataSource(events$) },
        { provide: CollectionLoaderService, useValue: stubLoader.service },
      ],
    });
    // Eager construction subscribes to events$.
    TestBed.inject(SidecarService);
  });

  it('patches the in-memory node store when a sidecar.bumped event arrives', () => {
    // Step 9.6.7 — `sidecar.bumped` now uses the canonical
    // `{ type, timestamp, data }` envelope. The BFF wraps the payload in
    // `data: { nodePath, version, status }` matching every other WS
    // event in the kernel→broadcaster bridge.
    events$.next({
      type: 'sidecar.bumped',
      timestamp: '2026-05-07T00:00:00.000Z',
      data: { nodePath: 'agents/architect.md', version: 2, status: 'fresh' },
    } as unknown as IWsEvent);
    expect(stubLoader.patchSpy).toHaveBeenCalledWith({
      nodePath: 'agents/architect.md',
      version: 2,
      status: 'fresh',
    });
    const node = stubLoader.nodes()[0];
    expect(node.sidecar?.status).toBe('fresh');
  });

  it('ignores non-sidecar.bumped events', () => {
    events$.next({
      type: 'scan.completed',
      timestamp: 0,
      data: {},
    } as unknown as IWsEvent);
    expect(stubLoader.patchSpy).not.toHaveBeenCalled();
  });

  it('ignores malformed sidecar.bumped frames (missing nodePath in data)', () => {
    events$.next({
      type: 'sidecar.bumped',
      timestamp: '2026-05-07T00:00:00.000Z',
      data: { version: 2, status: 'fresh' },
    } as unknown as IWsEvent);
    expect(stubLoader.patchSpy).not.toHaveBeenCalled();
  });
});
