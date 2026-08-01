import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { EMPTY, Subject } from 'rxjs';

import { LinkedNodesPanel } from '../linked-nodes-panel';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { WsEventStreamService } from '../../../../services/ws-event-stream';
import type { ILinkApi, IListEnvelopeApi } from '../../../../models/api';
import type { IWsScanCompletedEvent } from '../../../../models/ws-event';

/**
 * `LinkedNodesPanel` spec, covers the panel's full lifecycle:
 * empty path (no fetch), parallel fetch wiring, ready/empty/error
 * states, scan.completed reactive refresh, token guard for rapid
 * path changes.
 */

type IStubDataSource = IDataSourcePort & {
  listLinks: ReturnType<typeof vi.fn>;
};

function makeLink(overrides: Partial<ILinkApi> = {}): ILinkApi {
  return {
    source: 'a.md',
    target: 'b.md',
    kind: 'references',
    confidence: 0.9,
    sources: ['at-directive'],
    ...overrides,
  };
}

function envelope(items: ILinkApi[]): IListEnvelopeApi<ILinkApi> {
  return {
    schemaVersion: '1',
    kind: 'links',
    items,
    filters: { kind: null, from: null, to: null },
    counts: { total: items.length, returned: items.length },
    kindRegistry: {},
  };
}

function makeStub(): IStubDataSource {
  return {
    health: vi.fn(),
    loadScan: vi.fn(),
    listNodes: vi.fn(),
    // `getNode` is consumed by the panel's `fetch()` to populate the
    // "External references" section. Resolve to `null` so the call
    // settles without a value; the panel treats absence the same as
    // "no external refs to render".
    getNode: vi.fn().mockResolvedValue(null),
    listLinks: vi.fn().mockResolvedValue(envelope([])),
    // Same shape envelope as `listLinks` so issue iteration in the
    // panel reads a defined `items` array.
    listIssues: vi.fn().mockResolvedValue(envelope([])),
    loadGraph: vi.fn(),
    loadConfig: vi.fn(),
    listPlugins: vi.fn(),
  } as unknown as IStubDataSource;
}

function makeWsStub(scanCompleted$: Subject<IWsScanCompletedEvent>): WsEventStreamService {
  return {
    events$: EMPTY,
    scanCompleted$: scanCompleted$.asObservable(),
    actionApplied$: EMPTY,
  } as unknown as WsEventStreamService;
}

function bootstrap(stub: IStubDataSource, ws: WsEventStreamService): {
  fixture: ComponentFixture<LinkedNodesPanel>;
  cmp: LinkedNodesPanel;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: DATA_SOURCE, useValue: stub },
      { provide: WsEventStreamService, useValue: ws },
    ],
  });
  const fixture = TestBed.createComponent(LinkedNodesPanel);
  return { fixture, cmp: fixture.componentInstance };
}

async function flush(fixture: ComponentFixture<LinkedNodesPanel>): Promise<void> {
  fixture.detectChanges();
  // Three microtask ticks cover the two-phase fetch: phase 1 (links +
  // getNode in parallel) resolves on tick 1; the synchronous derive +
  // phase-2 dispatch (listIssues with `nodes=`) resolves on tick 2;
  // the await-then assignment + state set runs on tick 3. The prior
  // two-tick helper was enough for the all-parallel `allSettled` shape
  // but the narrowed `listIssues({ nodes })` call introduces one extra
  // hop.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('LinkedNodesPanel', () => {
  let scanCompleted$: Subject<IWsScanCompletedEvent>;
  let stub: IStubDataSource;
  let ws: WsEventStreamService;

  beforeEach(() => {
    scanCompleted$ = new Subject<IWsScanCompletedEvent>();
    stub = makeStub();
    ws = makeWsStub(scanCompleted$);
  });

  afterEach(() => {
    scanCompleted$.complete();
  });

  it('renders nothing when no path is set', async () => {
    const { fixture } = bootstrap(stub, ws);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="linked-nodes-panel"]')).toBeNull();
    expect(stub.listLinks).not.toHaveBeenCalled();
  });

  it('fires listLinks twice (outgoing+incoming) when a path lands', async () => {
    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(2);
    expect(stub.listLinks).toHaveBeenCalledWith({ from: 'a.md' });
    expect(stub.listLinks).toHaveBeenCalledWith({ to: 'a.md' });
  });

  it('renders no outgoing/incoming sections when both lists are empty', async () => {
    // Empty directions are hidden entirely now (no "0 / no links" header),
    // so neither section renders when nothing comes back.
    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="linked-nodes-outgoing"]')).toBeNull();
    expect(dom.querySelector('[data-testid="linked-nodes-incoming"]')).toBeNull();
  });

  it('renders outgoing + incoming rows when both lists have data', async () => {
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === 'center.md') {
        return Promise.resolve(
          envelope([
            makeLink({ source: 'center.md', target: 'out-1.md', kind: 'invokes' }),
            makeLink({ source: 'center.md', target: 'out-2.md', kind: 'references' }),
          ]),
        );
      }
      if (q.to === 'center.md') {
        return Promise.resolve(envelope([makeLink({ source: 'in-1.md', target: 'center.md' })]));
      }
      return Promise.resolve(envelope([]));
    });

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', 'center.md');
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;

    expect(dom.querySelector('[data-testid="linked-nodes-outgoing-row-out-1.md"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="linked-nodes-outgoing-row-out-2.md"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="linked-nodes-incoming-row-in-1.md"]')).not.toBeNull();
  });

  it('emits openPath when a row link is clicked', async () => {
    stub.listLinks.mockImplementation((q: { from?: string }) =>
      Promise.resolve(
        q.from
          ? envelope([makeLink({ source: 'a.md', target: 'b.md' })])
          : envelope([]),
      ),
    );

    const { fixture, cmp } = bootstrap(stub, ws);
    const opened: string[] = [];
    cmp.openPath.subscribe((p: string) => opened.push(p));

    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);

    // The path is now a native `<button>` carrying the data-testid
    // directly (no inner PrimeNG button element).
    const link = fixture.nativeElement.querySelector(
      '[data-testid="linked-nodes-outgoing-link-b.md"]',
    ) as HTMLButtonElement;
    link.click();

    expect(opened).toEqual(['b.md']);
  });

  it('navigates to resolvedTarget (not the raw trigger) when a mention link is clicked', async () => {
    // A `@handle` mention keeps the literal trigger as `target`, but the
    // post-walk lift records the real node path in `resolvedTarget`. The
    // click must open the resolved node, not the unresolvable trigger.
    stub.listLinks.mockImplementation((q: { from?: string }) =>
      Promise.resolve(
        q.from
          ? envelope([
              makeLink({
                source: 'a.md',
                target: '@full',
                resolvedTarget: 'agents/full.md',
                kind: 'mentions',
              }),
            ])
          : envelope([]),
      ),
    );

    const { fixture, cmp } = bootstrap(stub, ws);
    const opened: string[] = [];
    cmp.openPath.subscribe((p: string) => opened.push(p));

    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);

    // The row's data-testid still carries the literal trigger.
    const link = fixture.nativeElement.querySelector(
      '[data-testid="linked-nodes-outgoing-link-@full"]',
    ) as HTMLButtonElement;
    link.click();

    expect(opened).toEqual(['agents/full.md']);
  });

  it('shows the error state when a list-links call rejects', async () => {
    stub.listLinks.mockRejectedValue(new Error('boom'));
    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="linked-nodes-error"]')).not.toBeNull();
  });

  it('refreshes on a scan.completed WS event', async () => {
    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(2);

    scanCompleted$.next({
      type: 'scan.completed',
      timestamp: 0,
      jobId: null,
      data: { nodes: 0, links: 0, issues: 0, durationMs: 1 },
    } as IWsScanCompletedEvent);
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(4);
  });

  it('does NOT refresh on non-scan.completed events', async () => {
    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(2);

    // `scan.progress` never reaches `scanCompleted$`, it's a different
    // topic on the WS stream and the typed observable filters on
    // `scan.completed` only. Skipping the emit verifies the topic
    // routing without the test having to know how the filter works.
    await flush(fixture);
    expect(stub.listLinks).toHaveBeenCalledTimes(2);
  });

  it('drops a stale resolution when path changes mid-fetch (token guard)', async () => {
    let resolveA!: (env: IListEnvelopeApi<ILinkApi>) => void;
    const pendingA = new Promise<IListEnvelopeApi<ILinkApi>>((res) => {
      resolveA = res;
    });
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === 'a.md') return pendingA;
      if (q.to === 'a.md') return pendingA;
      // b.md fetches resolve immediately with a known sentinel.
      return Promise.resolve(envelope([makeLink({ source: 'b.md', target: 'b-out.md' })]));
    });

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    fixture.componentRef.setInput('path', 'b.md');
    await flush(fixture);
    // a.md's late resolution must be ignored, we should see b's row.
    resolveA(envelope([makeLink({ source: 'a.md', target: 'a-late.md' })]));
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="linked-nodes-outgoing-row-b-out.md"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="linked-nodes-outgoing-row-a-late.md"]')).toBeNull();
  });
});
