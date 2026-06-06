import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ConfirmationService, type Confirmation } from 'primeng/api';
import { EMPTY, Subject } from 'rxjs';

import { InspectorView } from '../inspector-view';
import { WsEventStreamService } from '../../../../services/ws-event-stream';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import { MarkdownRenderer } from '../../../../services/markdown-renderer';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { SidecarService } from '../../../../services/sidecar';
import { DataSourceError } from '../../../../services/data-source/data-source.port';
import type { INodeView, ISidecarOverlay } from '../../../../models/node';
import type { INodeDetailApi, INodeApi } from '../../../../models/api';

/**
 * Inspector view spec, Step 14.5.a body card lifecycle, Step 9.6.5
 * bump button + annotations, and the catalog curation 2026-05-07
 * surfaces (collapsible audit / plugin / debug; vendor frontmatter
 * tier card; supersededBy banner).
 */

// Section collapse state persists in localStorage; clear it before each
// test so collapse defaults are deterministic (everything collapsed by
// default EXCEPT body + findings) and tests do not leak state into each
// other.
beforeEach(() => {
  localStorage.clear();
});

type IStubDataSource = IDataSourcePort & {
  getNode: ReturnType<typeof vi.fn>;
};

type IStubLoader = {
  nodes: ReturnType<typeof signal<INodeView[]>>;
  loading: ReturnType<typeof signal<boolean>>;
  load: ReturnType<typeof vi.fn>;
};

function makeNode(overrides: Partial<INodeView> = {}): INodeView {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: {
      name: 'architect',
      description: 'The architect.',
      metadata: { version: '1.0.0' },
    },
    ...overrides,
  };
}

function makeApiNode(overrides: Partial<INodeApi> = {}): INodeApi {
  return {
    path: 'agents/architect.md',
    kind: 'agent',
    provider: 'claude',
    bodyHash: 'h',
    frontmatterHash: 'fh',
    bytes: { frontmatter: 10, body: 20, total: 30 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...overrides,
  };
}

function makeDetail(item: INodeApi): INodeDetailApi {
  return {
    schemaVersion: '1',
    kind: 'node',
    item,
    links: { incoming: [], outgoing: [] },
    issues: [],
    kindRegistry: {},
  };
}

function makeStubLoader(initialNodes: INodeView[] = []): IStubLoader {
  return {
    nodes: signal(initialNodes),
    loading: signal(false),
    load: vi.fn().mockResolvedValue(undefined),
  };
}

function makeStubDataSource(): IStubDataSource {
  return {
    health: vi.fn(),
    loadScan: vi.fn(),
    listNodes: vi.fn(),
    getNode: vi.fn(),
    listLinks: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'links',
      items: [],
      filters: { kind: null, from: null, to: null },
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
    listIssues: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'issues',
      items: [],
      filters: { severity: null, analyzerId: null, node: null },
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
    loadGraph: vi.fn(),
    loadConfig: vi.fn(),
    listPlugins: vi.fn(),
    bumpSidecar: vi.fn(),
    getUpdateStatus: vi.fn().mockResolvedValue({
      current: '0.0.0',
      latest: null,
      isOutdated: false,
      checkedAt: null,
      shownAt: null,
    }),
    getRegisteredAnnotations: vi.fn().mockResolvedValue([]),
    events: vi.fn().mockReturnValue(EMPTY),
  } as unknown as IStubDataSource;
}

class FakeMarkdownRenderer extends MarkdownRenderer {
  constructor(
    private readonly sanitizerRef: DomSanitizer,
    private readonly mode: 'pass' | 'throw',
  ) {
    super();
  }

  override async render(src: string): Promise<SafeHtml> {
    if (this.mode === 'throw') throw new Error('boom');
    return this.sanitizerRef.bypassSecurityTrustHtml(`<div data-fake>${src}</div>`);
  }
}

type IStubSidecar = {
  bump: ReturnType<typeof vi.fn>;
};

function makeStubSidecar(): IStubSidecar {
  return {
    bump: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'sidecar.bumped',
      value: { nodePath: '', version: 2, status: 'fresh' },
      elapsedMs: 1,
    }),
  };
}

/**
 * Phase 6, spy wrapper around the real `ConfirmationService`. The
 * `<p-confirmdialog />` component in the template subscribes to the
 * service's `requireConfirmation$` Subject; a fully-faked service that
 * omits the Subject crashes the directive on construction. We keep the
 * real service so the dialog wires up cleanly, but spy on `confirm()`
 * to capture the `Confirmation` config and expose synchronous `accept`
 * / `reject` helpers that fire the captured callback (without going
 * through the rendered button, the real button click depends on the
 * dialog being visible, which jsdom + transitions makes flaky).
 */
type IStubConfirmation = {
  confirm: ReturnType<typeof vi.fn>;
  lastCall: Confirmation | null;
  accept: () => void;
  reject: () => void;
};

function makeStubConfirmation(): IStubConfirmation {
  const real = new ConfirmationService();
  const stub: IStubConfirmation = {
    confirm: vi.fn(),
    lastCall: null,
    accept: (): void => {
      stub.lastCall?.accept?.();
    },
    reject: (): void => {
      stub.lastCall?.reject?.();
    },
  };
  stub.confirm.mockImplementation((c: Confirmation) => {
    stub.lastCall = c;
    real.confirm(c);
    return real;
  });
  // Surface the real subjects so `<p-confirmdialog />` can subscribe.
  // The Confirmation captured above is what the handler closes over,
  // so `accept` / `reject` fire the original callbacks regardless of
  // whether the dialog DOM actually rendered.
  Object.setPrototypeOf(stub, real);
  return stub;
}

interface IBootstrapOpts {
  loader?: IStubLoader;
  dataSource?: IStubDataSource;
  sidecar?: IStubSidecar;
  confirmation?: IStubConfirmation;
  rendererMode?: 'pass' | 'throw';
  /** Drives the body card's reactive `scan.completed` refresh. */
  scanCompleted$?: Subject<void>;
}

function bootstrap(opts: IBootstrapOpts = {}): {
  fixture: ComponentFixture<InspectorView>;
  cmp: InspectorView;
  loader: IStubLoader;
  dataSource: IStubDataSource;
  sidecar: IStubSidecar;
  confirmation: IStubConfirmation;
  scanCompleted$: Subject<void>;
} {
  const loader = opts.loader ?? makeStubLoader();
  const dataSource = opts.dataSource ?? makeStubDataSource();
  const sidecar = opts.sidecar ?? makeStubSidecar();
  const confirmation = opts.confirmation ?? makeStubConfirmation();
  const scanCompleted$ = opts.scanCompleted$ ?? new Subject<void>();

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: DATA_SOURCE, useValue: dataSource },
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
      { provide: CollectionLoaderService, useValue: loader },
      { provide: SidecarService, useValue: sidecar },
      // Stub the WS stream: the body card subscribes to `scanCompleted$`
      // for its reactive refresh. A Subject lets tests drive it; the
      // other streams are unused here so they resolve to EMPTY.
      {
        provide: WsEventStreamService,
        useValue: {
          scanCompleted$: scanCompleted$.asObservable(),
          events$: EMPTY,
          sidecarBumped$: EMPTY,
        } as unknown as WsEventStreamService,
      },
      {
        provide: MarkdownRenderer,
        useFactory: (): MarkdownRenderer =>
          new FakeMarkdownRenderer(TestBed.inject(DomSanitizer), opts.rendererMode ?? 'pass'),
      },
    ],
  });
  // `ConfirmationService` is component-scoped (`providers: [ConfirmationService]`
  // on `InspectorView`), so the only way to swap it is via
  // `overrideComponent`. The stub captures `confirm()` calls and lets
  // tests fire `accept` / `reject` synchronously.
  TestBed.overrideComponent(InspectorView, {
    set: { providers: [{ provide: ConfirmationService, useValue: confirmation }] },
  });
  const fixture = TestBed.createComponent(InspectorView);
  return { fixture, cmp: fixture.componentInstance, loader, dataSource, sidecar, confirmation, scanCompleted$ };
}

async function flush(fixture: ComponentFixture<InspectorView>): Promise<void> {
  fixture.detectChanges();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('InspectorView, empty states', () => {
  it('renders the no-selection empty state when path is undefined', async () => {
    const { fixture } = bootstrap();
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-empty-no-selection"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('renders the not-found empty state when the path is not in nodes()', async () => {
    const { fixture } = bootstrap();
    fixture.componentRef.setInput('path', 'agents/missing.md');
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-empty-not-found"]')).not.toBeNull();
  });
});

describe('InspectorView, body card lifecycle', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows the loading state while getNode() is in flight', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockReturnValue(new Promise(() => {}));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-body-loading"]')).not.toBeNull();
    expect(dataSource.getNode).toHaveBeenCalledWith(node.path, { includeBody: true });
  });

  it('renders the markdown HTML when getNode() returns a body', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# hello\n\nworld.' })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# hello');
    expect(rendered!.innerHTML).toContain('data-fake');
  });

  it('hides the body section when item.body is undefined (empty)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode()));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    // Nothing to render -> the whole Body section is omitted (no empty
    // placeholder).
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when item.body is null (file missing)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: null })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when getNode() returns null (404)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(null);

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when getNode() throws', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockRejectedValue(new Error('network down'));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('hides the body section when the markdown renderer throws', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# trips it' })));

    const { fixture } = bootstrap({ loader, dataSource, rendererMode: 'throw' });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
  });

  it('drops a stale resolution when the user navigates to a different path mid-fetch', async () => {
    const nodeA = makeNode({ path: 'a.md', frontmatter: { name: 'A', description: '', metadata: { version: '' } } });
    const nodeB = makeNode({ path: 'b.md', frontmatter: { name: 'B', description: '', metadata: { version: '' } } });
    const loader = makeStubLoader([nodeA, nodeB]);
    const dataSource = makeStubDataSource();

    let resolveA!: (v: INodeDetailApi) => void;
    const pendingA = new Promise<INodeDetailApi>((res) => {
      resolveA = res;
    });
    dataSource.getNode.mockImplementation((p: string) => {
      if (p === 'a.md') return pendingA;
      return Promise.resolve(makeDetail(makeApiNode({ path: 'b.md', body: '# B body' })));
    });

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', 'a.md');
    await flush(fixture);
    fixture.componentRef.setInput('path', 'b.md');
    await flush(fixture);

    resolveA(makeDetail(makeApiNode({ path: 'a.md', body: '# A body, late' })));
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# B body');
    expect(rendered!.innerHTML).not.toContain('A body');
  });

  it('re-fetches and re-renders the body on a scan.completed event (reactive refresh)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# first' })));

    const { fixture, scanCompleted$ } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-body-rendered"]')!.innerHTML,
    ).toContain('# first');
    // Multiple consumers call getNode on selection (body card + the
    // linked-nodes panel), so assert the call count GROWS after the
    // event rather than pinning an exact number; the body content swap
    // below is the real proof of the reactive re-render.
    const callsBeforeEvent = dataSource.getNode.mock.calls.length;

    // The file body changes on disk and the watcher re-scans: getNode now
    // returns the new body, and the scan.completed event triggers a silent
    // re-fetch for the SAME path (no navigation, no path-signal change).
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# second' })));
    scanCompleted$.next();
    await flush(fixture);

    expect(dataSource.getNode.mock.calls.length).toBeGreaterThan(callsBeforeEvent);
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered!.innerHTML).toContain('# second');
    expect(rendered!.innerHTML).not.toContain('# first');
  });

  it('ignores scan.completed when no node is selected (no fetch)', async () => {
    const dataSource = makeStubDataSource();
    const { fixture, scanCompleted$ } = bootstrap({ dataSource });
    await flush(fixture);

    scanCompleted$.next();
    await flush(fixture);

    expect(dataSource.getNode).not.toHaveBeenCalled();
  });
});

describe('InspectorView, vendor frontmatter card (catalog curation)', () => {
  it('renders the vendor frontmatter card on every kind that has a vendor surface', async () => {
    const node = makeNode({
      kind: 'agent',
      frontmatter: {
        name: 'architect',
        description: 'd',
        model: 'opus',
        metadata: { version: '1.0.0' },
      } as INodeView['frontmatter'],
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));

    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-vendor-frontmatter"]')).not.toBeNull();
  });
});

// Smoke: confirm the router is reachable so node-open navigation
// (via NODE_OPEN_INTENT's default Router-backed implementation) wires up.
describe('InspectorView, router smoke', () => {
  it('has a router available for in-app navigation links', () => {
    bootstrap();
    expect(TestBed.inject(Router)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Step 9.6.5, bump button + annotations panel
// ---------------------------------------------------------------------------

function makeNodeWithSidecar(overlay: ISidecarOverlay | undefined): INodeView {
  const view: INodeView = {
    path: 'agents/architect.md',
    kind: 'agent',
    frontmatter: {
      name: 'architect',
      description: 'd',
      metadata: { version: '1' },
    },
  };
  if (overlay) view.sidecar = overlay;
  return view;
}

describe('InspectorView, bump button (Step 9.6.5)', () => {
  it('renders the bump button on a selected node', async () => {
    const node = makeNodeWithSidecar(undefined);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-bump"]')).not.toBeNull();
  });

  it('disables the bump button when the sidecar overlay is fresh', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: { version: 1 } });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-bump"] button',
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  it('enables the bump button when the sidecar overlay is stale-body', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'stale-body', annotations: { version: 1 } });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-bump"] button',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('disables the bump button when no sidecar overlay is present (creation now routes through the CLI)', async () => {
    const node = makeNodeWithSidecar(undefined);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-bump"] button',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('invokes SidecarService.bump on click with the current node path (no `reason` arg)', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'stale-body', annotations: { version: 1 } });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture, sidecar } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-bump"] button',
    ) as HTMLButtonElement;
    btn.click();
    await flush(fixture);
    expect(sidecar.bump).toHaveBeenCalledWith(node.path);
  });

  it('surfaces an error banner with sidecar-fresh code on a 409 refusal', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'stale-body', annotations: { version: 1 } });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const sidecar = makeStubSidecar();
    sidecar.bump.mockRejectedValue(new DataSourceError('sidecar-fresh', 'fresh'));
    const { fixture } = bootstrap({ loader, dataSource, sidecar });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-bump"] button',
    ) as HTMLButtonElement;
    btn.click();
    await flush(fixture);
    const banner = fixture.nativeElement.querySelector('[data-testid="inspector-bump-error"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/fresh/i);
  });
});

// ---------------------------------------------------------------------------
// Phase 6, `.sm` sidecar consent gate (allowEditSmFiles)
// ---------------------------------------------------------------------------

describe('InspectorView, bump consent dialog (Phase 6)', () => {
  function bumpClickableNode(): INodeView {
    return makeNodeWithSidecar({ present: true, status: 'stale-body', annotations: { version: 1 } });
  }

  it('opens the consent dialog on a 412 confirm-required response for allowEditSmFiles', async () => {
    const node = bumpClickableNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const sidecar = makeStubSidecar();
    sidecar.bump.mockRejectedValueOnce(
      new DataSourceError('confirm-required', 'needs consent', { key: 'allowEditSmFiles' }),
    );
    const { fixture, confirmation } = bootstrap({ loader, dataSource, sidecar });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-bump"] button',
    ) as HTMLButtonElement;
    btn.click();
    await flush(fixture);

    expect(confirmation.confirm).toHaveBeenCalledTimes(1);
    const arg = confirmation.lastCall;
    expect(arg).not.toBeNull();
    // Header / message are end-user copy (friendly, non-technical); we
    // assert they exist and the message carries enough body to be a
    // real explanation, but we don't lock to specific strings, that
    // would couple the test to the marketing voice.
    expect(arg!.header).toBeTruthy();
    expect(typeof arg!.message).toBe('string');
    expect((arg!.message as string).length).toBeGreaterThan(40);
    expect(arg!.acceptLabel).toBeTruthy();
    expect(arg!.rejectLabel).toBeTruthy();
    // The first-pass error must NOT leak into the banner, the dialog
    // is the only surface the user sees.
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-bump-error"]')).toBeNull();
  });

  it('re-issues the bump with confirm:true when the user accepts the dialog', async () => {
    const node = bumpClickableNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const sidecar = makeStubSidecar();
    sidecar.bump
      .mockRejectedValueOnce(
        new DataSourceError('confirm-required', 'needs consent', { key: 'allowEditSmFiles' }),
      )
      .mockResolvedValueOnce({
        schemaVersion: '1',
        kind: 'sidecar.bumped',
        value: { nodePath: node.path, version: 2, status: 'fresh' },
        elapsedMs: 3,
      });
    const { fixture, confirmation } = bootstrap({ loader, dataSource, sidecar });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-bump"] button',
    ) as HTMLButtonElement;
    btn.click();
    await flush(fixture);

    expect(sidecar.bump).toHaveBeenCalledTimes(1);
    expect(sidecar.bump).toHaveBeenNthCalledWith(1, node.path);

    confirmation.accept();
    await flush(fixture);

    expect(sidecar.bump).toHaveBeenCalledTimes(2);
    expect(sidecar.bump).toHaveBeenNthCalledWith(2, node.path, { confirm: true });
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-bump-error"]')).toBeNull();
  });

  it('does NOT re-issue the bump when the user rejects the dialog', async () => {
    const node = bumpClickableNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const sidecar = makeStubSidecar();
    sidecar.bump.mockRejectedValueOnce(
      new DataSourceError('confirm-required', 'needs consent', { key: 'allowEditSmFiles' }),
    );
    const { fixture, confirmation } = bootstrap({ loader, dataSource, sidecar });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-bump"] button',
    ) as HTMLButtonElement;
    btn.click();
    await flush(fixture);

    expect(sidecar.bump).toHaveBeenCalledTimes(1);

    confirmation.reject();
    await flush(fixture);

    expect(sidecar.bump).toHaveBeenCalledTimes(1);
    // Silent abandon, no error banner either (matches the
    // `settings-project.ts` precedent for the referencePaths consent).
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-bump-error"]')).toBeNull();
  });

  it('falls back to the error banner when confirm-required carries an unknown details.key', async () => {
    const node = bumpClickableNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const sidecar = makeStubSidecar();
    sidecar.bump.mockRejectedValueOnce(
      new DataSourceError('confirm-required', 'needs consent', { key: 'someOtherKey' }),
    );
    const { fixture, confirmation } = bootstrap({ loader, dataSource, sidecar });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-bump"] button',
    ) as HTMLButtonElement;
    btn.click();
    await flush(fixture);

    expect(confirmation.confirm).not.toHaveBeenCalled();
    const banner = fixture.nativeElement.querySelector('[data-testid="inspector-bump-error"]');
    expect(banner).not.toBeNull();
  });
});

describe('InspectorView, annotations card (Step 9.6.5)', () => {
  it('does NOT render the annotations card when no sidecar overlay is present', async () => {
    const node = makeNodeWithSidecar(undefined);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-annotations"]')).toBeNull();
  });

  it('renders the annotations card when sidecar overlay is present', async () => {
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { version: 3, stability: 'stable' },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-annotations"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Catalog curation 2026-05-07, collapsibles + debug toggle + banner
// ---------------------------------------------------------------------------

describe('InspectorView, collapsible sections (catalog curation)', () => {
  async function renderInspector(overlay?: ISidecarOverlay): Promise<HTMLElement> {
    const node = makeNodeWithSidecar(overlay);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the metadata section collapsed by default', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // The section renders (the node has a sidecar), but collapsed: its
    // body (the audit panel) is NOT in the DOM until the user expands it.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-metadata"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-audit-panel-empty"]'),
    ).toBeNull();
  });

  it('expands the metadata section on header click', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // Collapsed by default: the audit-panel-empty body is absent.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-audit-panel-empty"]'),
    ).toBeNull();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-metadata-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    toggle.click();
    await flush(fixture);
    // After expanding, the body appears in the DOM.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-audit-panel-empty"]'),
    ).not.toBeNull();
  });

  it('does NOT render the plugin contributions section when sidecar has no non-reserved keys', async () => {
    const dom = await renderInspector();
    // The card chrome only renders when the sidecar carries at least
    // one non-reserved root key (catalog curation, empty cards were
    // painting blank borders on plain nodes).
    expect(dom.querySelector('[data-testid="inspector-card-plugins"]')).toBeNull();
  });

  it('renders the plugin contributions section when sidecar root carries a non-reserved key', async () => {
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: {},
      root: { 'my-plugin': { foo: 1 } },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-plugins"]'),
    ).not.toBeNull();
    // Collapsed by default, so the namespace block is not rendered until
    // the user expands the section.
    expect(
      fixture.nativeElement.querySelector('[data-testid="plugin-contributions-ns-my-plugin"]'),
    ).toBeNull();
  });

  it('persists a section collapse to localStorage', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    // Body must have content so the (default-expanded) body section
    // renders and its toggle is present to click.
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '# body' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-body-toggle"]',
    ) as HTMLButtonElement;
    // Body defaults to expanded, so the first toggle collapses it.
    toggle.click();
    await flush(fixture);
    const stored = JSON.parse(
      localStorage.getItem('skill-map.ui.inspector.sections') ?? '{}',
    ) as Record<string, boolean>;
    expect(stored['body']).toBe(false);
  });
});

describe('InspectorView, debug panel inside the merged metadata section', () => {
  it('renders the debug panel inside the metadata section when expanded', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // Metadata is collapsed by default, so the debug panel starts hidden.
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-metadata-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-metadata-section"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).not.toBeNull();
  });

  it('does not render the metadata section for a node without a sidecar', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // No sidecar -> the metadata section (and the debug panel it hosts)
    // is omitted entirely.
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-metadata"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
  });

  it('toggles the audit + debug panels on metadata expand/collapse', async () => {
    const node = makeNodeWithSidecar({ present: true, status: 'fresh', annotations: {} });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-metadata-toggle"]',
    ) as HTMLButtonElement;
    // Collapsed by default.
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
    toggle.click(); // expand
    await flush(fixture);
    // Both sub-panels appear: the audit empty-state and the debug grid.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-audit-panel-empty"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).not.toBeNull();
    toggle.click(); // collapse again
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
  });
});

describe('InspectorView, supersededBy banner (catalog curation)', () => {
  it('renders the banner when annotations.supersededBy is set', async () => {
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { supersededBy: 'agents/v2.md' },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const banner = fixture.nativeElement.querySelector('[data-testid="inspector-superseded-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('agents/v2.md');
  });

  it('hides the banner when supersededBy is absent', async () => {
    const dom = await (async (): Promise<HTMLElement> => {
      const node = makeNode();
      const loader = makeStubLoader([node]);
      const dataSource = makeStubDataSource();
      dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
      const { fixture } = bootstrap({ loader, dataSource });
      fixture.componentRef.setInput('path', node.path);
      await flush(fixture);
      return fixture.nativeElement as HTMLElement;
    })();
    expect(dom.querySelector('[data-testid="inspector-superseded-banner"]')).toBeNull();
  });
});

describe('InspectorView, header version (catalog curation)', () => {
  it('renders sidecar.annotations.version as a header suffix', async () => {
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { version: 7 },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const v = fixture.nativeElement.querySelector('[data-testid="inspector-version"]');
    expect(v).not.toBeNull();
    expect(v!.textContent).toContain('v7');
  });
});
