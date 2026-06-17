import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
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
import type { INodeView, ISidecarOverlay } from '../../../../models/node';
import type { INodeDetailApi, INodeApi } from '../../../../models/api';

/**
 * Inspector view spec, Step 14.5.a body card lifecycle, annotations,
 * the generic action-button toolbar (contribution-driven, the bump
 * button is no longer hardcoded), and the catalog curation 2026-05-07
 * surfaces (collapsible audit / plugin / debug; vendor frontmatter
 * tier card).
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
    dispatchAction: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'action.applied',
      value: { actionId: 'core/node-bump', nodePath: '' },
      elapsedMs: 1,
    }),
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

interface IBootstrapOpts {
  loader?: IStubLoader;
  dataSource?: IStubDataSource;
  rendererMode?: 'pass' | 'throw';
  /** Drives the body card's reactive `scan.completed` refresh. */
  scanCompleted$?: Subject<void>;
}

function bootstrap(opts: IBootstrapOpts = {}): {
  fixture: ComponentFixture<InspectorView>;
  cmp: InspectorView;
  loader: IStubLoader;
  dataSource: IStubDataSource;
  scanCompleted$: Subject<void>;
} {
  const loader = opts.loader ?? makeStubLoader();
  const dataSource = opts.dataSource ?? makeStubDataSource();
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
  const fixture = TestBed.createComponent(InspectorView);
  return { fixture, cmp: fixture.componentInstance, loader, dataSource, scanCompleted$ };
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
// Action toolbar (contribution-driven) + annotations panel
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

describe('InspectorView, actions section (contribution-driven)', () => {
  it('renders the Actions section hosting the inspector.action.button slot when the node has action contributions', async () => {
    const node: INodeView = {
      path: 'agents/architect.md',
      kind: 'agent',
      frontmatter: { name: 'architect', description: 'd', metadata: { version: '1' } },
      contributions: [
        {
          pluginId: 'core',
          extensionId: 'node-set-stability',
          nodePath: 'agents/architect.md',
          contributionId: 'setStabilityButton',
          slot: 'inspector.action.button',
          payload: { actionId: 'core/node-set-stability', label: 'Set stability', enabled: true },
        },
      ],
    };
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const dom: HTMLElement = fixture.nativeElement;
    const section = dom.querySelector('[data-testid="inspector-card-actions"]');
    expect(section).not.toBeNull();
    // The slot host is mounted inside the (default-expanded) section.
    expect(section!.querySelector('sm-view-contributions-host')).not.toBeNull();
    // No hardcoded bump button; it arrives as a contribution.
    expect(dom.querySelector('[data-testid="inspector-bump"]')).toBeNull();
  });

  it('does NOT render the Actions section when the node has no action contributions', async () => {
    const node = makeNodeWithSidecar(undefined);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-actions"]')).toBeNull();
  });

  it('renders the consent dialog component (driven by the dispatch service)', async () => {
    const node = makeNodeWithSidecar(undefined);
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // The standalone dialog component is mounted in the template; its
    // inner `<p-dialog>` stays hidden (open=false) until a dispatch hits
    // the consent gate, so we assert on the component host element.
    expect(fixture.nativeElement.querySelector('sm-sidecar-consent-dialog')).not.toBeNull();
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

  it('renders the annotations card when the sidecar carries renderable annotations', async () => {
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { source: 'https://example.com/repo' },
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-annotations"]')).not.toBeNull();
  });

  it('does NOT render the annotations card when the sidecar is present but has no renderable annotations', async () => {
    // version / stability are node properties shown elsewhere, not in the
    // annotations panel (which renders provenance / repository / docs), so
    // a sidecar carrying only those has nothing to show and the section is
    // hidden entirely instead of rendering an empty panel.
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
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-card-annotations"]')).toBeNull();
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
