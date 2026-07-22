import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { EMPTY, Subject } from 'rxjs';

import { InspectorView } from '../inspector-view';
import { NODE_OPEN_INTENT } from '../../../slots/node-open-intent';
import { ActionDispatchService } from '../../../../services/action-dispatch';
import { WsEventStreamService } from '../../../../services/ws-event-stream';
import {
  DATA_SOURCE,
  DataSourceError,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import { MarkdownRenderer } from '../../../../services/markdown-renderer';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { LivePreferencesService } from '../../../../services/live-preferences';
import { NodeActivityStatsService } from '../../../../services/node-activity-stats';
import { ProviderRegistryService } from '../../../../services/provider-registry';
import type { INodeView, ISidecarOverlay } from '../../../../models/node';
import { activityPairKeyOf } from '../../../../models/api';
import type {
  IActivityRunApi,
  IFindingApi,
  IFindingsEnvelopeApi,
  INodeSummaryRowApi,
  INodeDetailApi,
  INodeApi,
  INodeActivityStatsApi,
  IProbExtensionEntryApi,
  IProbExtensionsApi,
} from '../../../../models/api';
import type { ISpawnThread } from '../../../components/conversation-dialog/spawn-thread';

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
  getNodeActivity: ReturnType<typeof vi.fn>;
  getNodeFindings: ReturnType<typeof vi.fn>;
  getNodeSummary: ReturnType<typeof vi.fn>;
  deleteNodeSummary: ReturnType<typeof vi.fn>;
  getNodeProbExtensions: ReturnType<typeof vi.fn>;
  submitNodeJob: ReturnType<typeof vi.fn>;
  cancelJob: ReturnType<typeof vi.fn>;
  dismissFinding: ReturnType<typeof vi.fn>;
  reopenFinding: ReturnType<typeof vi.fn>;
  resolveFinding: ReturnType<typeof vi.fn>;
  undismissFinding: ReturnType<typeof vi.fn>;
  deleteFinding: ReturnType<typeof vi.fn>;
};

type IStubLoader = {
  nodes: ReturnType<typeof signal<INodeView[]>>;
  scanMeta: ReturnType<typeof signal<unknown>>;
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
    // The `core/node-set-tags` contribution gates the header's tag row
    // (surface follows the plugin); default it on so the tag-row and
    // auto-tag specs keep their surface. Override with `contributions`
    // to model other rosters (it replaces this default).
    contributions: [
      {
        pluginId: 'core',
        extensionId: 'node-set-tags',
        nodePath: 'agents/architect.md',
        contributionId: 'editTagsButton',
        slot: 'inspector.action.button',
        payload: { actionId: 'core/node-set-tags', surface: 'tags', label: 'Edit tags', enabled: true },
      },
    ],
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
    // The inspector's ngOnInit boot guard reads `scanMeta()`; a non-null
    // value keeps it from kicking a (stubbed) `load()` under test.
    scanMeta: signal<unknown>({}),
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
    getNodeActivity: vi.fn().mockResolvedValue({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    }),
    getNodeFindings: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'findings',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0, dismissedExcluded: 0, fixedExcluded: 0 },
      kindRegistry: {},
    }),
    getNodeProbExtensions: vi.fn().mockResolvedValue({
      finders: [],
      standalone: [],
    }),
    submitNodeJob: vi.fn().mockResolvedValue({
      schemaVersion: '1',
      kind: 'job.submitted',
      value: { jobId: 'job-1', nodePath: '', extensionId: '', supersededIds: [] },
      elapsedMs: 1,
    }),
    cancelJob: vi.fn().mockResolvedValue(undefined),
    dismissFinding: vi.fn().mockResolvedValue(undefined),
    reopenFinding: vi.fn().mockResolvedValue(undefined),
    resolveFinding: vi.fn().mockResolvedValue(undefined),
    undismissFinding: vi.fn().mockResolvedValue(undefined),
    deleteFinding: vi.fn().mockResolvedValue(undefined),
    getNodeSummary: vi.fn().mockResolvedValue([]),
    deleteNodeSummary: vi.fn().mockResolvedValue(undefined),
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

  // Raw-view highlighter stub: wrap the source verbatim so tests can assert
  // on its text without loading the real highlight.js chunk in jsdom.
  override async highlightSource(src: string): Promise<SafeHtml> {
    if (this.mode === 'throw') throw new Error('boom');
    return this.sanitizerRef.bypassSecurityTrustHtml(`<span data-fake-raw>${src}</span>`);
  }
}

interface IBootstrapOpts {
  loader?: IStubLoader;
  dataSource?: IStubDataSource;
  rendererMode?: 'pass' | 'throw';
  /** Drives the body card's reactive `scan.completed` refresh. */
  scanCompleted$?: Subject<void>;
  /** Drives the Activity section's live `node.activity` re-fetch. */
  nodeActivity$?: Subject<void>;
  /** Drives the Activity section's live `agent.spawn` re-fetch. */
  agentSpawn$?: Subject<void>;
  /** Drives the AI actions card's live `job.*` re-fetch. */
  jobEvents$?: Subject<void>;
  /** Seeds the per-node stats mirror that gates the Activity section. */
  activityStats?: ReadonlyMap<string, INodeActivityStatsApi>;
  /** Seeds the per-pair spawn counters (Activity gate, spawn side). */
  activityPairs?: ReadonlyMap<string, number>;
  /** Seeds the persistent-runs set (Activity gate, DB-history side). */
  activityRunNodes?: ReadonlySet<string>;
  /** Real-time activity preference (default ON, like the app). */
  activityEnabled?: boolean;
}

/** Stats entry seed for the Activity visibility gate. */
function makeActivityStats(overrides: Partial<INodeActivityStatsApi> = {}): INodeActivityStatsApi {
  return { count: 1, lastStartAt: 1000, distinctOwners: 1, ...overrides };
}

function bootstrap(opts: IBootstrapOpts = {}): {
  fixture: ComponentFixture<InspectorView>;
  cmp: InspectorView;
  loader: IStubLoader;
  dataSource: IStubDataSource;
  scanCompleted$: Subject<void>;
  nodeActivity$: Subject<void>;
  agentSpawn$: Subject<void>;
  jobEvents$: Subject<void>;
} {
  const loader = opts.loader ?? makeStubLoader();
  const dataSource = opts.dataSource ?? makeStubDataSource();
  const scanCompleted$ = opts.scanCompleted$ ?? new Subject<void>();
  const nodeActivity$ = opts.nodeActivity$ ?? new Subject<void>();
  const agentSpawn$ = opts.agentSpawn$ ?? new Subject<void>();
  const jobEvents$ = opts.jobEvents$ ?? new Subject<void>();

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
          // The Activity section's live re-fetch merges these two streams;
          // Subjects let tests drive `node.activity` and `agent.spawn` frames.
          nodeActivity$: nodeActivity$.asObservable(),
          agentSpawn$: agentSpawn$.asObservable(),
          // The AI actions card re-fetches on any job lifecycle frame.
          jobEvents$: jobEvents$.asObservable(),
          jobSubmitted$: EMPTY,
        } as unknown as WsEventStreamService,
      },
      {
        provide: MarkdownRenderer,
        useFactory: (): MarkdownRenderer =>
          new FakeMarkdownRenderer(TestBed.inject(DomSanitizer), opts.rendererMode ?? 'pass'),
      },
      // The Activity section's visibility gate reads the per-node stats
      // mirror; the real service subscribes to WS streams the stub above
      // does not expose, so tests seed plain signal maps instead.
      {
        provide: NodeActivityStatsService,
        useValue: {
          stats: signal<ReadonlyMap<string, INodeActivityStatsApi>>(
            opts.activityStats ?? new Map(),
          ),
          pairCounts: signal<ReadonlyMap<string, number>>(opts.activityPairs ?? new Map()),
          runNodes: signal<ReadonlySet<string>>(opts.activityRunNodes ?? new Set()),
        } as unknown as NodeActivityStatsService,
      },
      {
        provide: LivePreferencesService,
        useValue: {
          activityEnabled: signal(opts.activityEnabled ?? true),
        } as unknown as LivePreferencesService,
      },
    ],
  });
  const fixture = TestBed.createComponent(InspectorView);
  return {
    fixture,
    cmp: fixture.componentInstance,
    loader,
    dataSource,
    scanCompleted$,
    nodeActivity$,
    agentSpawn$,
    jobEvents$,
  };
}

async function flush(fixture: ComponentFixture<InspectorView>): Promise<void> {
  fixture.detectChanges();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('InspectorView, conversation dialog (no-fetch openThread path)', () => {
  it('hands the clicked thread to the shared controller without fetching', async () => {
    const { fixture, cmp, dataSource } = bootstrap();
    await flush(fixture);

    const probe = cmp as unknown as {
      openSpawnConversation(thread: ISpawnThread): void;
      onConversationClosed(): void;
      conversationOpen(): boolean;
      conversationThread(): ISpawnThread | null;
    };
    const thread: ISpawnThread = {
      key: 'main:1|agents/worker.md',
      parentOwner: 'main:1',
      parentNodePath: 'agents/orchestrator.md',
      childNodePath: 'agents/worker.md',
      records: [],
    };

    expect(probe.conversationOpen()).toBe(false);
    probe.openSpawnConversation(thread);
    expect(probe.conversationOpen()).toBe(true);
    // Handed over verbatim: the inspector already holds the records,
    // so the controller's fetch paths (openSpawn / openHistorical)
    // must stay untouched on this surface.
    expect(probe.conversationThread()).toBe(thread);
    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();

    probe.onConversationClosed();
    expect(probe.conversationOpen()).toBe(false);
  });
});

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

describe('InspectorView, body raw / rendered toggle', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function renderBody(body: string): Promise<ComponentFixture<InspectorView>> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    return fixture;
  }

  it('defaults to the rendered view and shows the toggle when the body is ready', async () => {
    const dom = (await renderBody('# hello\n\nworld')).nativeElement as HTMLElement;
    expect(dom.querySelector('[data-testid="inspector-body-view-toggle"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-body-rendered"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-body-raw"]')).toBeNull();
  });

  it('swaps to the raw source on toggle and back to rendered on a second click', async () => {
    const fixture = await renderBody('# hello\n\nworld');
    const dom = fixture.nativeElement as HTMLElement;

    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);
    const raw = dom.querySelector('[data-testid="inspector-body-raw"]');
    expect(raw).not.toBeNull();
    // The raw view shows the source verbatim (the `#` markdown is NOT rendered).
    expect(raw!.textContent).toContain('# hello');
    expect(dom.querySelector('[data-testid="inspector-body-rendered"]')).toBeNull();

    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-body-rendered"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-body-raw"]')).toBeNull();
  });

  it('renders the raw view as a line-numbered, highlighted editor', async () => {
    const fixture = await renderBody('# title\nbody line');
    const dom = fixture.nativeElement as HTMLElement;
    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);

    // Gutter: one number per source line.
    const gutter = dom.querySelector('.inspector__body-raw-gutter');
    expect(gutter).not.toBeNull();
    expect(gutter!.textContent).toBe('1\n2');

    // Code: the highlight.js container, source text intact.
    const code = dom.querySelector('[data-testid="inspector-body-raw-code"]');
    expect(code).not.toBeNull();
    expect(code!.classList.contains('hljs')).toBe(true);
    expect(code!.textContent).toContain('# title');
  });
});

describe('InspectorView, codex / bodyField inline body', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function makeCodexNode(developerInstructions: string | undefined): INodeView {
    const frontmatter: Record<string, unknown> = {
      name: 'architect',
      description: 'd',
      model: 'gpt-5-codex',
      sandbox_mode: 'read-only',
    };
    if (developerInstructions !== undefined) {
      frontmatter['developer_instructions'] = developerInstructions;
    }
    return makeNode({
      path: '.codex/agents/architect.toml',
      kind: 'agent',
      provider: 'codex',
      frontmatter: frontmatter as unknown as INodeView['frontmatter'],
    });
  }

  /** Seed the provider registry with a codex entry declaring its bodyField. */
  function seedCodexRegistry(): void {
    TestBed.inject(ProviderRegistryService).ingest({
      codex: {
        label: 'OpenAI Codex',
        color: '#22c55e',
        isLens: true,
        bodyField: 'developer_instructions',
      },
    });
  }

  it('renders developer_instructions as the body and never asks the BFF for the raw file', async () => {
    const node = makeCodexNode('# Codex prompt\n\nbody from the TOML field');
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    // If the body card ever hit the disk-read path it would render this raw
    // TOML stand-in; the inline path must win.
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', body: 'RAW TOML never renders' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# Codex prompt');
    expect(rendered!.innerHTML).not.toContain('RAW TOML');
    // The body card never requests the on-demand disk read for a bodyField
    // provider (other panels may call getNode, but not with includeBody).
    expect(dataSource.getNode).not.toHaveBeenCalledWith(node.path, { includeBody: true });
  });

  it('renders a codex skill (.md, no developer_instructions) from its fetched markdown body', async () => {
    // Regression: the codex Provider declares `bodyField: developer_instructions`
    // for its `.toml` agents, but its open-standard `.agents/skills/*/SKILL.md`
    // skills (same provider id) have no such field. They must fall back to the
    // normal body fetch, not render an empty (hidden) Body section.
    const node = makeNode({
      path: '.agents/skills/run-tests/SKILL.md',
      kind: 'skill',
      provider: 'codex',
      frontmatter: { name: 'run-tests', description: 'd' } as unknown as INodeView['frontmatter'],
    });
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', kind: 'skill', body: '# Run tests\n\nDo it.' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const rendered = dom.querySelector('[data-testid="inspector-body-rendered"]');
    expect(rendered).not.toBeNull();
    expect(rendered!.innerHTML).toContain('# Run tests');
    // A skill with no bodyField value pulls its body from the disk fetch.
    expect(dataSource.getNode).toHaveBeenCalledWith(node.path, { includeBody: true });
  });

  it('shows the raw developer_instructions verbatim when toggled to the raw view', async () => {
    const node = makeCodexNode('# Codex prompt\n\nbody from the TOML field');
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', body: 'RAW TOML never renders' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    (dom.querySelector('[data-testid="inspector-body-view-toggle"]') as HTMLButtonElement).click();
    await flush(fixture);
    const raw = dom.querySelector('[data-testid="inspector-body-raw"]');
    expect(raw).not.toBeNull();
    // The raw view is the developer_instructions source, not the BFF's raw TOML.
    expect(raw!.textContent).toContain('# Codex prompt');
    expect(raw!.textContent).not.toContain('RAW TOML');
  });

  it('hides the body section for a codex node with an empty developer_instructions (no disk fallback)', async () => {
    const node = makeCodexNode('');
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(
      makeDetail(makeApiNode({ provider: 'codex', body: 'RAW TOML never renders' })),
    );

    const { fixture } = bootstrap({ loader, dataSource });
    seedCodexRegistry();
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    // Empty effective body -> the whole section is omitted, and we never
    // fall back to the disk read (which would hand back raw TOML).
    expect(dom.querySelector('[data-testid="inspector-card-body"]')).toBeNull();
    expect(dataSource.getNode).not.toHaveBeenCalledWith(node.path, { includeBody: true });
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
          pluginId: 'my-plugin',
          extensionId: 'my-action',
          nodePath: 'agents/architect.md',
          contributionId: 'myButton',
          slot: 'inspector.action.button',
          payload: { actionId: 'my-plugin/my-action', label: 'Do it', enabled: true },
        },
        // Set stability AND Bump moved to the header chips (user calls
        // 2026-07-21): neither renders inside the Actions section.
        {
          pluginId: 'core',
          extensionId: 'node-set-stability',
          nodePath: 'agents/architect.md',
          contributionId: 'setStabilityButton',
          slot: 'inspector.action.button',
          payload: { actionId: 'core/node-set-stability', surface: 'stability', label: 'Set stability', enabled: true },
        },
        {
          pluginId: 'core',
          extensionId: 'node-bump',
          nodePath: 'agents/architect.md',
          contributionId: 'bumpButton',
          slot: 'inspector.action.button',
          payload: { actionId: 'core/node-bump', surface: 'version', label: 'Bump', enabled: true },
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
    // The set-stability and bump buttons are EXCLUDED from the section
    // (they live on the header's stability / version chips now).
    expect(section!.querySelector('[data-testid="action-core/node-set-stability"]')).toBeNull();
    expect(section!.querySelector('[data-testid="action-core/node-bump"]')).toBeNull();
    // The neutral third-party action still renders.
    expect(section!.querySelector('[data-testid="action-my-plugin/my-action"]')).not.toBeNull();
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
    // body (the debug panel) is NOT in the DOM until the user expands it.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-metadata"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]'),
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
    // Collapsed by default: the metadata body is absent.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]'),
    ).toBeNull();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-metadata-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    toggle.click();
    await flush(fixture);
    // After expanding, the body appears in the DOM.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]'),
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
    // The debug grid appears (the audit panel self-hides here: this node's
    // sidecar carries no populated audit block).
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).not.toBeNull();
    toggle.click(); // collapse again
    await flush(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="inspector-debug-panel"]')).toBeNull();
  });
});

describe('InspectorView, activity section visibility gate', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('hides the section entirely for a node with no recorded activity', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).toBeNull();
  });

  it('does not fetch the detail for a hidden section even with a persisted-open state', async () => {
    localStorage.setItem('skill-map.ui.inspector.sections', JSON.stringify({ activity: true }));
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();
  });

  it('shows the section when the stats mirror carries the node', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).not.toBeNull();
  });

  it('shows the section on PERSISTENT run history alone (server restarted, counters reset)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    // No stats entry, no spawn pair: only the summary's runNodes carries
    // the node (its state_executions history survived the reboot).
    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityRunNodes: new Set([node.path]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).not.toBeNull();
  });

  it('shows the section when a spawn pair touches the node as child', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityPairs: new Map([[activityPairKeyOf('main:6cfe5636', node.path), 2]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).not.toBeNull();
  });

  it('keeps the section available while real-time activity is OFF (mirror unknowable)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    const { fixture } = bootstrap({ loader, dataSource, activityEnabled: false });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-activity"]'),
    ).not.toBeNull();
  });
});

describe('InspectorView, activity thread rows (spawn grouping)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function makeSpawn(spawnId: string, startedAt: number, status: string): Record<string, unknown> {
    return {
      spawnId,
      parentOwner: 'main:6cfe5636',
      childKind: 'agent',
      childName: 'demo-worker',
      childNodePath: '.claude/agents/demo-worker.md',
      prompt: `ask ${spawnId}`,
      response: `reply ${spawnId}`,
      startedAt,
      status,
    };
  }

  it('groups 3 spawn records of the same pair into ONE thread row with "3 exchanges"', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 3, lastStartAt: 3000, distinctOwners: 1 },
      recent: [],
      spawns: [makeSpawn('s2', 2000, 'ended'), makeSpawn('s1', 1000, 'ended'), makeSpawn('s3', 3000, 'running')],
      captureEnabled: true,
      runs: [],
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats({ count: 3, lastStartAt: 3000 })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    // Activity is collapsed by default; expand it to trigger the fetch.
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);

    expect(dataSource.getNodeActivity).toHaveBeenCalledWith(node.path);
    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid="inspector-activity-thread"]',
    );
    expect(rows.length).toBe(1);
    // Child name + exchange counter + status of the LAST turn.
    expect(rows[0]!.textContent).toContain('demo-worker');
    expect(rows[0]!.textContent).toContain('3 exchanges');
    expect(rows[0]!.textContent).toContain('running');
    // One View-conversation button per thread, not per record.
    expect(
      fixture.nativeElement.querySelectorAll(
        '[data-testid="inspector-activity-view-conversation"]',
      ).length,
    ).toBe(1);
    // Capture chip shows: the gate is on AND this node has captured spawns.
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-activity-capture-chip"]'),
    ).not.toBeNull();
  });

  it('hides the capture chip when the gate is on but no conversations were captured', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
      runs: [],
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);

    // Gate on but spawns empty: the chip stays hidden (no noise).
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-activity-capture-chip"]'),
    ).toBeNull();
  });

  it('caps the conversation threads shown per node at 10', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    // 12 DISTINCT pairs (distinct childNodePath => distinct thread key).
    const spawns = Array.from({ length: 12 }, (_, i) => ({
      ...makeSpawn(`s${i}`, (i + 1) * 1000, 'ended'),
      childNodePath: `.claude/agents/w${i}.md`,
    }));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 12, lastStartAt: 12000, distinctOwners: 1 },
      recent: [],
      spawns,
      captureEnabled: true,
      runs: [],
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats({ count: 12, lastStartAt: 12000 })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);

    // 12 distinct conversations exist, but only the 10 newest render.
    expect(
      fixture.nativeElement.querySelectorAll('[data-testid="inspector-activity-thread"]').length,
    ).toBe(10);
  });
});

describe('InspectorView, activity execution aggregates (stats totals row)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Boots on a node, expands the Activity section, settles the fetch. */
  async function bootWithStats(stats: Record<string, unknown>): Promise<HTMLElement> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats,
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('never renders the stats grid (dropped 2026-07-17: the timeline carries the story)', async () => {
    const dom = await bootWithStats({
      count: 3,
      lastStartAt: 3000,
      distinctOwners: 1,
      toolUses: 14,
      tokens: 8300,
      summarizedRuns: 2,
    });
    expect(dom.querySelector('[data-testid="inspector-activity-stats"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-exec-totals"]')).toBeNull();
  });
});

describe('InspectorView, activity recent tool detail', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the per-run tool detail when present and skips it when absent', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 2, lastStartAt: 3000, distinctOwners: 1 },
      recent: [
        { at: 3000, owner: 'main:abc', detail: 'notion-create-pages' },
        { at: 2000, owner: 'main:abc' },
      ],
      spawns: [],
      captureEnabled: false,
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats({ count: 2, lastStartAt: 3000 })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);

    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid="inspector-activity-recent-row"]',
    );
    expect(rows.length).toBe(2);
    // Only the frame that carried a detail paints the tool label.
    const details = fixture.nativeElement.querySelectorAll(
      '[data-testid="inspector-activity-recent-detail"]',
    );
    expect(details.length).toBe(1);
    expect(details[0]!.textContent).toContain('notion-create-pages');
  });
});

describe('InspectorView, activity recent directional invocations', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** Boots on a node, expands the Activity section with the given recent ring. */
  async function bootWithRecent(
    recent: readonly Record<string, unknown>[],
  ): Promise<ComponentFixture<InspectorView>> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: recent.length, lastStartAt: 3000, distinctOwners: 1 },
      recent,
      spawns: [],
      captureEnabled: false,
      runs: [],
    });

    const { fixture } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats({ count: recent.length })]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    return fixture;
  }

  it('renders an MCP INCOMING row (caller): type icon, node link, tool, and navigates', async () => {
    const fixture = await bootWithRecent([
      {
        at: 3000,
        owner: 'main:abc',
        kind: 'mcp',
        detail: 'notion-create-pages',
        caller: '.claude/skills/deploy/SKILL.md',
      },
    ]);
    const dom: HTMLElement = fixture.nativeElement;
    // MCP type icon (wrench), not the read icon.
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-mcp"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-read"]')).toBeNull();
    const link = dom.querySelector(
      '[data-testid="inspector-activity-recent-node"]',
    ) as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    // Counterpart (the caller) shown as its readable node label, raw path in title.
    expect(link!.textContent).toContain('deploy');
    expect(link!.getAttribute('title')).toBe('.claude/skills/deploy/SKILL.md');
    // An mcp row carries the trailing tool segment.
    const tool = dom.querySelector('[data-testid="inspector-activity-recent-tool"]');
    expect(tool).not.toBeNull();
    expect(tool!.textContent).toContain('notion-create-pages');
    expect(dom.querySelector('[data-testid="inspector-activity-recent-detail"]')).toBeNull();

    // Clicking the link navigates via the shared node-open intent.
    const openSpy = vi.spyOn(TestBed.inject(NODE_OPEN_INTENT), 'open');
    link!.click();
    expect(openSpy).toHaveBeenCalledWith('.claude/skills/deploy/SKILL.md');
  });

  it('renders an MCP OUTGOING row (target) with the mcp server name and navigates', async () => {
    const fixture = await bootWithRecent([
      { at: 3000, owner: 'main:abc', kind: 'mcp', detail: 'notion-create-pages', target: 'mcp://notion' },
    ]);
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-mcp"]')).not.toBeNull();
    const link = dom.querySelector(
      '[data-testid="inspector-activity-recent-node"]',
    ) as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    // Counterpart (the target) shown as the mcp server name, not `mcp://notion`.
    expect(link!.textContent).toContain('notion');
    expect(link!.textContent).not.toContain('mcp://');
    expect(link!.getAttribute('title')).toBe('mcp://notion');
    expect(dom.querySelector('[data-testid="inspector-activity-recent-tool"]')).not.toBeNull();

    const openSpy = vi.spyOn(TestBed.inject(NODE_OPEN_INTENT), 'open');
    link!.click();
    expect(openSpy).toHaveBeenCalledWith('mcp://notion');
  });

  it('renders a READ row (kind read, no detail): type icon + node link, NO tool segment', async () => {
    const fixture = await bootWithRecent([
      { at: 3000, owner: 'main:abc', kind: 'read', target: 'docs/architecture.md' },
    ]);
    const dom: HTMLElement = fixture.nativeElement;
    // Read type icon (document), not the mcp icon.
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-read"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-icon-mcp"]')).toBeNull();
    const link = dom.querySelector(
      '[data-testid="inspector-activity-recent-node"]',
    ) as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('architecture');
    expect(link!.getAttribute('title')).toBe('docs/architecture.md');
    // A read has no tool, so NO trailing tool segment (and no plain chip).
    expect(dom.querySelector('[data-testid="inspector-activity-recent-tool"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-detail"]')).toBeNull();

    const openSpy = vi.spyOn(TestBed.inject(NODE_OPEN_INTENT), 'open');
    link!.click();
    expect(openSpy).toHaveBeenCalledWith('docs/architecture.md');
  });

  it('renders a PLAIN row (neither caller nor target) with the short owner and no node link', async () => {
    const fixture = await bootWithRecent([{ at: 3000, owner: 'main:abc', detail: 'read-tool' }]);
    const dom: HTMLElement = fixture.nativeElement;
    // Plain detail chip, no node link.
    expect(dom.querySelector('[data-testid="inspector-activity-recent-detail"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-activity-recent-node"]')).toBeNull();
    // The short owner still renders on the row.
    const row = dom.querySelector('[data-testid="inspector-activity-recent-row"]');
    expect(row!.textContent).toContain('main:abc');
  });
});

/** AI-run entry seed for the merged-timeline suites. */
function makeRun(overrides: Partial<IActivityRunApi> = {}): IActivityRunApi {
  return {
    executionId: 'exec-1',
    extensionId: 'core/ai-redundancy-analyzer',
    status: 'completed',
    model: 'claude-sonnet',
    durationMs: 2000,
    finishedAt: 2000,
    failureReason: null,
    ...overrides,
  };
}

/** Boots on a node, expands Activity, settles the fetch of the given detail. */
async function bootWithTimeline(
  recent: readonly Record<string, unknown>[],
  runs: readonly IActivityRunApi[],
): Promise<ComponentFixture<InspectorView>> {
  const node = makeNode();
  const loader = makeStubLoader([node]);
  const dataSource = makeStubDataSource();
  dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
  dataSource.getNodeActivity.mockResolvedValue({
    stats: { count: recent.length, lastStartAt: 3000, distinctOwners: 1 },
    recent,
    spawns: [],
    captureEnabled: false,
    runs,
  });
  const { fixture } = bootstrap({
    loader,
    dataSource,
    activityStats: new Map([[node.path, makeActivityStats()]]),
  });
  fixture.componentRef.setInput('path', node.path);
  await flush(fixture);
  const toggle = fixture.nativeElement.querySelector(
    '[data-testid="inspector-activity-toggle"]',
  ) as HTMLButtonElement;
  toggle.click();
  await flush(fixture);
  await flush(fixture);
  return fixture;
}

describe('InspectorView, activity merged timeline (runtime + AI runs)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('interleaves AI runs into the timeline, newest first, timestampless runs last', async () => {
    const fixture = await bootWithTimeline(
      [
        { at: 3000, owner: 'main:abc' },
        { at: 1000, owner: 'main:abc' },
      ],
      [
        makeRun({ executionId: 'e1', finishedAt: 2000 }),
        // Unfinished run: no timestamp, must sink to the end.
        makeRun({
          executionId: 'e2',
          status: 'running',
          finishedAt: null,
          durationMs: null,
          model: null,
        }),
      ],
    );
    const dom: HTMLElement = fixture.nativeElement;
    // querySelectorAll returns document order, i.e. render order.
    const rows = dom.querySelectorAll(
      '[data-testid="inspector-activity-recent-row"], [data-testid="inspector-activity-run-row"]',
    );
    expect(rows.length).toBe(4);
    expect(rows[0]!.getAttribute('data-testid')).toBe('inspector-activity-recent-row'); // at 3000
    expect(rows[1]!.getAttribute('data-testid')).toBe('inspector-activity-run-row'); // finished 2000
    expect(rows[2]!.getAttribute('data-testid')).toBe('inspector-activity-recent-row'); // at 1000
    expect(rows[3]!.getAttribute('data-testid')).toBe('inspector-activity-run-row'); // null, sinks
  });

  it('renders an AI-run row visually distinguished: sparkles icon + extension · duration (no core/ prefix, no model, completed status omitted)', async () => {
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc' }],
      [makeRun({ executionId: 'e1', finishedAt: 2000 })],
    );
    const dom: HTMLElement = fixture.nativeElement;
    const row = dom.querySelector('[data-testid="inspector-activity-run-row"]');
    expect(row).not.toBeNull();
    // Own glyph (sparkles), distinct from the runtime wrench / document icons.
    const icon = row!.querySelector('[data-testid="inspector-activity-run-icon"]');
    expect(icon).not.toBeNull();
    expect(icon!.classList.contains('pi-sparkles')).toBe(true);
    // The `core/` built-in prefix and the model are dropped from the row
    // (user call 2026-07-20); the happy-path `completed` status is omitted.
    expect(row!.textContent).toContain('ai-redundancy-analyzer · 2s');
    expect(row!.textContent).not.toContain('core/');
    expect(row!.textContent).not.toContain('claude-sonnet');
    expect(row!.textContent).not.toContain('completed');
    // A clean run carries no failure tooltip.
    expect(row!.getAttribute('title')).toBeNull();
  });

  it('surfaces the failureReason as the failed run row tooltip', async () => {
    const fixture = await bootWithTimeline(
      [],
      [
        makeRun({
          executionId: 'e1',
          status: 'failed',
          finishedAt: 2000,
          failureReason: 'agent timed out',
        }),
      ],
    );
    const row = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="inspector-activity-run-row"]',
    );
    expect(row!.getAttribute('title')).toBe('agent timed out');
    // A non-completed status IS surfaced, on the prefix-stripped id.
    expect(row!.textContent).toContain('ai-redundancy-analyzer · failed · 2s');
  });

  it('shows AI runs even when the runtime half is quiet (empty stats)', async () => {
    const fixture = await bootWithTimeline([], [makeRun({ executionId: 'e1', finishedAt: 2000 })]);
    const dom: HTMLElement = fixture.nativeElement;
    // Not the quiet-node empty line: the persistent runs still show.
    expect(dom.querySelector('[data-testid="inspector-activity-empty"]')).toBeNull();
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);
  });

  it('renders the runtime-only timeline unchanged when runs is empty', async () => {
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc', detail: 'read-tool' }],
      [],
    );
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(0);
    expect(
      dom.querySelector('[data-testid="inspector-activity-recent-detail"]')!.textContent,
    ).toContain('read-tool');
  });

  it('filters the timeline by provenance via the three-state control', async () => {
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc' }],
      [makeRun({ executionId: 'e1', finishedAt: 2000 })],
    );
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-activity-filter"]')).not.toBeNull();
    // Default 'all': both provenances visible.
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);

    (dom.querySelector('[data-testid="inspector-activity-filter-runtime"]') as HTMLElement).click();
    await flush(fixture);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(0);

    (dom.querySelector('[data-testid="inspector-activity-filter-ai"]') as HTMLElement).click();
    await flush(fixture);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(0);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);

    (dom.querySelector('[data-testid="inspector-activity-filter-all"]') as HTMLElement).click();
    await flush(fixture);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);
  });

  it('shows the filtered-empty line when the active filter matches nothing', async () => {
    const fixture = await bootWithTimeline([{ at: 3000, owner: 'main:abc' }], []);
    const dom: HTMLElement = fixture.nativeElement;
    (dom.querySelector('[data-testid="inspector-activity-filter-ai"]') as HTMLElement).click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-activity-filter-empty"]')).not.toBeNull();
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(0);
  });
});

describe('InspectorView, activity filter persistence (inspector-level)', () => {
  const STORAGE_KEY = 'skill-map.ui.inspector.activityFilter';

  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('applies a persisted filter at init', async () => {
    localStorage.setItem(STORAGE_KEY, 'ai');
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc' }],
      [makeRun({ executionId: 'e1', finishedAt: 2000 })],
    );
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(0);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);
  });

  it('persists a filter change back to localStorage', async () => {
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc' }],
      [makeRun({ executionId: 'e1', finishedAt: 2000 })],
    );
    const dom: HTMLElement = fixture.nativeElement;
    (dom.querySelector('[data-testid="inspector-activity-filter-runtime"]') as HTMLElement).click();
    await flush(fixture);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('runtime');
  });

  it('falls back to "all" on an unknown stored value (defensive parse)', async () => {
    localStorage.setItem(STORAGE_KEY, 'bogus');
    const fixture = await bootWithTimeline(
      [{ at: 3000, owner: 'main:abc' }],
      [makeRun({ executionId: 'e1', finishedAt: 2000 })],
    );
    const dom: HTMLElement = fixture.nativeElement;
    // Both provenances visible, i.e. the filter resolved to 'all'.
    expect(dom.querySelectorAll('[data-testid="inspector-activity-recent-row"]').length).toBe(1);
    expect(dom.querySelectorAll('[data-testid="inspector-activity-run-row"]').length).toBe(1);
  });
});

describe('InspectorView, activity live refresh (node.activity re-fetch)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('re-fetches the activity detail on a node.activity frame while the section is open', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
      runs: [],
    });

    const { fixture, nodeActivity$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    // Expand the Activity section: the first (loud) fetch.
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    expect(dataSource.getNodeActivity).toHaveBeenCalledWith(node.path);
    const before = dataSource.getNodeActivity.mock.calls.length;

    // A live execution frame lands: after the debounce window the section
    // silently re-fetches the SAME node's detail (no navigation, no scan).
    vi.useFakeTimers();
    try {
      nodeActivity$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity.mock.calls.length).toBeGreaterThan(before);
  });

  it('re-fetches the activity detail on a job.completed frame while the section is open (AI-run history stays live)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
      runs: [],
    });

    const { fixture, jobEvents$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);

    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    expect(dataSource.getNodeActivity).toHaveBeenCalledWith(node.path);
    const before = dataSource.getNodeActivity.mock.calls.length;

    // `sm record` writes the `state_executions` AI-run row then pushes
    // `job.completed`, a frame that carries NO `node.activity`. Without the
    // job stream in the Activity refresh merge, a finder / summarizer run
    // (which touches no file, so no re-scan follows) never surfaced until an
    // unrelated refresh. Here the section re-fetches after the debounce.
    vi.useFakeTimers();
    try {
      jobEvents$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity.mock.calls.length).toBeGreaterThan(before);
  });

  it('coalesces a burst of node.activity frames into ONE re-fetch (debounced)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
      runs: [],
    });

    const { fixture, nodeActivity$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    const before = dataSource.getNodeActivity.mock.calls.length;

    // Five frames inside one debounce window collapse to a single trailing
    // re-fetch, not five GETs.
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) {
        nodeActivity$.next();
        vi.advanceTimersByTime(100);
      }
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity.mock.calls.length).toBe(before + 1);
  });

  it('re-fetches the activity detail on an agent.spawn frame while the section is open', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    dataSource.getNodeActivity.mockResolvedValue({
      stats: { count: 1, lastStartAt: 1000, distinctOwners: 1 },
      recent: [],
      spawns: [],
      captureEnabled: true,
      runs: [],
    });

    const { fixture, agentSpawn$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="inspector-activity-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    await flush(fixture);
    await flush(fixture);
    const before = dataSource.getNodeActivity.mock.calls.length;

    // A spawn thread starts: the section's spawn rows must refresh live too.
    vi.useFakeTimers();
    try {
      agentSpawn$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity.mock.calls.length).toBeGreaterThan(before);
  });

  it('ignores node.activity frames when the section was never opened (no fetch)', async () => {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));

    const { fixture, nodeActivity$ } = bootstrap({
      loader,
      dataSource,
      activityStats: new Map([[node.path, makeActivityStats()]]),
    });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    // Section is collapsed by default: never fetched, so the guard holds.
    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      nodeActivity$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeActivity).not.toHaveBeenCalled();
  });
});

describe('InspectorView, header version (catalog curation)', () => {
  it('renders sidecar.annotations.version on the bump chip while core/node-bump is enabled', async () => {
    // The version chip is the Bump affordance (user call 2026-07-21):
    // it renders only while the `core/node-bump` contribution is present.
    const node = makeNodeWithSidecar({
      present: true,
      status: 'fresh',
      annotations: { version: 7 },
    });
    node.contributions = [
      {
        pluginId: 'core',
        extensionId: 'node-bump',
        nodePath: node.path,
        contributionId: 'bumpButton',
        slot: 'inspector.action.button',
        payload: { actionId: 'core/node-bump', surface: 'version', label: 'Bump', enabled: false, disabledReason: 'fresh' },
      },
    ];
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

  it('shows NO version surface with the plugin disabled (no contribution)', async () => {
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
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-version"]'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AI actions card (Step 16 piece 1, the findings workbench)
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<IFindingApi> = {}): IFindingApi {
  return {
    id: 12,
    nodeId: 'agents/architect.md',
    extensionId: 'core/todo-finder',
    extensionVersion: '1.0.0',
    origin: 'extension',
    type: 'stale-todo',
    severity: 'warn',
    message: 'The TODO at line 4 looks abandoned.',
    detail: null,
    confidence: 0.87,
    model: 'claude-opus-4',
    resolution: null,
    resolutionActor: null,
    resolutionNote: null,
    resolutionBy: null,
    resolutionAt: null,
    stale: false,
    generatedAt: 1_700_000_000_000,
    jobId: 'job-1',
    ...overrides,
  };
}

function makeFindingsEnvelope(
  items: IFindingApi[],
  countsOverrides: Partial<IFindingsEnvelopeApi['counts']> = {},
): IFindingsEnvelopeApi {
  return {
    schemaVersion: '1',
    kind: 'findings',
    items,
    filters: {},
    counts: {
      total: items.length,
      returned: items.length,
      dismissedExcluded: 0,
      fixedExcluded: 0,
      ...countsOverrides,
    },
    kindRegistry: {},
  };
}

function makeProbEntry(overrides: Partial<IProbExtensionEntryApi> = {}): IProbExtensionEntryApi {
  return {
    id: 'core/todo-finder',
    description: 'Judges whether TODO markers look abandoned.',
    state: 'idle',
    // Idle default: no active job handle. Queued/running fixtures pass
    // an explicit id (the stop/restart companions hang off it).
    jobId: null,
    lastJudged: null,
    // Two-state defaults: no fixer, no open findings (the Detect-only
    // shape). Finder-with-fixer fixtures pass an explicit `fixerIds`;
    // the Fix state fixtures additionally pass `hasOpenFindings: true`.
    fixerIds: [],
    hasOpenFindings: false,
    // No active fixer job: every row's fix affordance idle.
    fixerBusy: null,
    ...overrides,
  };
}

function makeProbExtensions(overrides: Partial<IProbExtensionsApi> = {}): IProbExtensionsApi {
  return { finders: [], standalone: [], ...overrides };
}

describe('InspectorView, AI actions card (Step 16 piece 1)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  interface IAiActionsBoot {
    findings?: IFindingsEnvelopeApi;
    probs?: IProbExtensionsApi;
    summaries?: INodeSummaryRowApi[];
}

  async function bootAiActions(opts: IAiActionsBoot = {}): Promise<{
    fixture: ComponentFixture<InspectorView>;
    dataSource: IStubDataSource;
    node: INodeView;
    jobEvents$: Subject<void>;
  }> {
    const node = makeNode();
    const loader = makeStubLoader([node]);
    const dataSource = makeStubDataSource();
    dataSource.getNode.mockResolvedValue(makeDetail(makeApiNode({ body: '' })));
    if (opts.findings) dataSource.getNodeFindings.mockResolvedValue(opts.findings);
    if (opts.probs) dataSource.getNodeProbExtensions.mockResolvedValue(opts.probs);
    if (opts.summaries) dataSource.getNodeSummary.mockResolvedValue(opts.summaries);
    const { fixture, jobEvents$ } = bootstrap({ loader, dataSource });
    fixture.componentRef.setInput('path', node.path);
    await flush(fixture);
    await flush(fixture);
    return { fixture, dataSource, node, jobEvents$ };
  }

  it('hides the card entirely when there are no launchers, no findings, and nothing hidden', async () => {
    const { fixture } = await bootAiActions();
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-card-ai-actions"]'),
    ).toBeNull();
  });

  it('renders TWO launcher rows: finders (with their ALL) on top, standalone (with theirs) below', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })],
        standalone: [makeProbEntry({ id: 'core/summarizer', description: 'Summarizes the node.' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-ai-actions"]')).not.toBeNull();
    // Two rows (user call 2026-07-22), each led by its type-scoped ALL.
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-launchers-row-finders"]'),
    ).not.toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-launchers-row-standalone"]'),
    ).not.toBeNull();
    // Both rows present: the ALL buttons are type-qualified (user call
    // 2026-07-22); with a single group the label stays a bare "ALL".
    const allFinders = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-all-finders"]',
    );
    const allStandalone = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-all-standalone"]',
    );
    expect(allFinders).not.toBeNull();
    expect(allStandalone).not.toBeNull();
    expect(allFinders!.textContent).toContain('ALL finders');
    expect(allStandalone!.textContent).toContain('ALL standalone');
    // The button LABEL is always the kind (short name); the Detect/Fix
    // state rides `data-action` + the icon, not the label (user call
    // 2026-07-18).
    const finder = dom.querySelector('[data-testid="inspector-ai-action-launch-core/todo-finder"]');
    expect(finder).not.toBeNull();
    expect(finder!.textContent).toContain('todo-finder');
    expect(finder!.textContent).not.toContain('Detect');
    expect(finder!.getAttribute('data-action')).toBe('detect');
    // Standalone button shows the short extension name (segment after the slash).
    const standalone = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/summarizer"]',
    );
    expect(standalone).not.toBeNull();
    expect(standalone!.textContent).toContain('summarizer');
    expect(standalone!.textContent).not.toContain('core/');
    expect(standalone!.getAttribute('data-action')).toBe('run');
    // No fresh findings: no list and no filler either, the launchers
    // stand alone (empty-state removed per user call 2026-07-17).
    expect(dom.querySelector('[data-testid="inspector-ai-actions-empty"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-actions-list"]')).toBeNull();
  });

  it('a single-group card keeps the bare ALL label', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })],
      }),
    });
    const all = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-all-finders"]',
    ) as HTMLElement;
    expect(all).not.toBeNull();
    expect(all.textContent).toContain('ALL');
    expect(all.textContent).not.toContain('ALL finders');
  });

  it('each ALL button queues ONLY its own type', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'], hasOpenFindings: false })],
        standalone: [makeProbEntry({ id: 'core/summarizer', description: 'Summarizes the node.' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const allFinders = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-all-finders"] button',
    ) as HTMLButtonElement;
    allFinders.click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/todo-finder', false);
    expect(dataSource.submitNodeJob).toHaveBeenCalledTimes(1);

    const allStandalone = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-all-standalone"] button',
    ) as HTMLButtonElement;
    allStandalone.click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/summarizer', false);
    expect(dataSource.submitNodeJob).toHaveBeenCalledTimes(2);
  });

  it('a finder with open findings sits DISABLED (no more Detect => Fix morph)', async () => {
    // No open findings: the button submits the FINDER on click.
    const detect = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'], hasOpenFindings: false })],
      }),
    });
    const detectBtn = detect.fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    expect(detectBtn.textContent).toContain('todo-finder');
    expect(detectBtn.getAttribute('data-action')).toBe('detect');
    (detectBtn.querySelector('button') as HTMLButtonElement).click();
    await flush(detect.fixture);
    expect(detect.dataSource.submitNodeJob).toHaveBeenCalledWith(
      detect.node.path,
      'core/todo-finder',
      false,
    );

    // Open findings: the button DISABLES (re-running is pointless; the
    // fix lives on each finding row, user call 2026-07-20).
    const open = await bootAiActions({
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({
            fixerIds: ['core/todo-fixer', 'core/todo-fixer-2'],
            hasOpenFindings: true,
          }),
        ],
      }),
    });
    const openBtn = open.fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"] button',
    ) as HTMLButtonElement;
    expect(openBtn.disabled).toBe(true);
    openBtn.click();
    await flush(open.fixture);
    expect(open.dataSource.submitNodeJob).not.toHaveBeenCalled();
  });

  it('the per-finding wrench queues the fixer(s); rows without a fixer render none', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      findings: makeFindingsEnvelope([
        makeFinding(),
        makeFinding({ id: 30, extensionId: 'core/orphan-finder' }),
      ]),
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({
            fixerIds: ['core/todo-fixer', 'core/todo-fixer-2'],
            hasOpenFindings: true,
          }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    // The finding of an unknown finder (no catalog entry) has no wrench.
    expect(dom.querySelector('[data-testid="inspector-finding-fix-30"]')).toBeNull();

    (
      dom.querySelector('[data-testid="inspector-finding-fix-12"] button') as HTMLButtonElement
    ).click();
    await flush(fixture);
    // Chains all fixers, autoFix false, TARGETING ONLY THIS ROW's
    // finding (user decision 2026-07-22: per-finding fix jobs), and
    // never submits the finder itself.
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/todo-fixer', false, [12]);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/todo-fixer-2', false, [12]);
    expect(dataSource.submitNodeJob).not.toHaveBeenCalledWith(
      node.path,
      'core/todo-finder',
      expect.anything(),
    );
    // No flicker (user report 2026-07-22): the submit round-trip ended
    // but the refetched entry does not yet report the fixer job; the
    // optimistic overlay keeps THIS row's bolt disabled until a payload
    // confirms, while the sibling row stays free.
    expect(
      (dom.querySelector('[data-testid="inspector-finding-fix-12"] button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('the header summarize ? queues the summarizer; the summarizer never rides the launcher row', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({
        standalone: [
          makeProbEntry({ id: 'core/ai-summarizer-action', description: 'Summarizes.' }),
          makeProbEntry({ id: 'core/other-action', description: 'Other.' }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    // Excluded from the launchers (it owns the header affordance)...
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-launch-core/ai-summarizer-action"]'),
    ).toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-launch-core/other-action"]'),
    ).not.toBeNull();
    // ...and the header shows the idle ?-with-magic button.
    const btn = dom.querySelector('[data-testid="inspector-summarize"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('data-state')).toBe('idle');
    btn.click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(
      node.path,
      'core/ai-summarizer-action',
      false,
    );
  });

  it('the tag-row sparkles queues the auto-tagger; the tagger never rides the launcher row', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({
        standalone: [
          makeProbEntry({ id: 'core/ai-tagger-action', description: 'Tags.' }),
          makeProbEntry({ id: 'core/other-action', description: 'Other.' }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    // Excluded from the launchers (it owns the tag-row affordance)...
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-launch-core/ai-tagger-action"]'),
    ).toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-launch-core/other-action"]'),
    ).not.toBeNull();
    // ...and the tag row shows the idle sparkles button.
    const btn = dom.querySelector('[data-testid="node-tags-auto"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('data-state')).toBe('idle');
    btn.click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(
      node.path,
      'core/ai-tagger-action',
      false,
    );
  });

  it('without the tagger extension the tag row shows no sparkles button', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        standalone: [makeProbEntry({ id: 'core/other-action', description: 'Other.' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="node-tags-auto"]')).toBeNull();
  });

  it('with a stored summary the header button is ready and toggles the analysis block', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        standalone: [makeProbEntry({ id: 'core/ai-summarizer-action', description: 'S.' })],
      }),
      summaries: [
        {
          summarizerActionId: 'core/ai-summarizer-action',
          generatedAt: 1000,
          stale: false,
          report: {
            whatItCovers: 'Deploys the service to production.',
            topics: ['deploy', 'ops'],
            keyFacts: ['Runs on push to main.'],
            qualityNotes: ['The rollback step is undocumented.'],
          },
        },
      ],
    });
    const dom: HTMLElement = fixture.nativeElement;
    const btn = dom.querySelector('[data-testid="inspector-summarize"]') as HTMLButtonElement;
    expect(btn.getAttribute('data-state')).toBe('ready');
    // A summarized node opens with its analysis VISIBLE (user call
    // 2026-07-21); the button collapses / re-expands it.
    const block = dom.querySelector('[data-testid="inspector-summary"]');
    expect(block).not.toBeNull();
    expect(block!.textContent).toContain('Deploys the service to production.');
    // Topics and related files are deliberately NOT rendered (user call
    // 2026-07-21); facts and quality notes are.
    expect(block!.textContent).toContain('Runs on push to main.');
    expect(block!.textContent).toContain('The rollback step is undocumented.');
    btn.click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-summary"]')).toBeNull();
  });

  it('the summary delete X removes the analysis and the header falls back to idle', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({
        standalone: [makeProbEntry({ id: 'core/ai-summarizer-action', description: 'S.' })],
      }),
      summaries: [
        {
          summarizerActionId: 'core/ai-summarizer-action',
          generatedAt: 1000,
          stale: false,
          report: { whatItCovers: 'Covers deploys.' },
        },
      ],
    });
    const dom: HTMLElement = fixture.nativeElement;
    // Auto-expanded on load; after the delete the refetch returns empty.
    expect(dom.querySelector('[data-testid="inspector-summary"]')).not.toBeNull();
    dataSource.getNodeSummary.mockResolvedValue([]);
    (
      dom.querySelector('[data-testid="inspector-summary-delete"]') as HTMLButtonElement
    ).click();
    await flush(fixture);
    await flush(fixture);
    expect(dataSource.deleteNodeSummary).toHaveBeenCalledWith(
      node.path,
      'core/ai-summarizer-action',
    );
    expect(dom.querySelector('[data-testid="inspector-summary"]')).toBeNull();
    // Back to the idle invitation state.
    expect(
      dom.querySelector('[data-testid="inspector-summarize"]')!.getAttribute('data-state'),
    ).toBe('idle');
  });

  it('a human-decision row shows the needs-decision mark and NO fix button', async () => {
    // The fixer left this one to the author (resolution = human-decision):
    // the submit gate refuses to re-inject it, so the bolt must not
    // render; mark-fixed + dismiss remain as the two valid exits.
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([
        makeFinding({ resolution: 'human-decision', resolutionActor: 'fixer' }),
      ]),
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'], hasOpenFindings: true })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-finding-fix-12"]')).toBeNull();
    const mark = dom.querySelector('[data-testid="inspector-finding-decision-12"]');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toContain('needs decision');
    expect(dom.querySelector('[data-testid="inspector-finding-resolve-12"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-finding-dismiss-12"]')).not.toBeNull();
  });

  it('a subset fixer job disables ONLY its row; the sibling stays clickable', async () => {
    // Per-finding fix (user decision 2026-07-22): the entry reports an
    // active fixer job frozen to finding 12; row 30 (same finder) must
    // stay fully actionable.
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([makeFinding(), makeFinding({ id: 30 })]),
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({
            fixerIds: ['core/todo-fixer'],
            hasOpenFindings: true,
            state: 'queued',
            jobId: 'job-9',
            fixerBusy: { all: false, findingIds: [12] },
          }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const busyBtn = dom.querySelector(
      '[data-testid="inspector-finding-fix-12"] button',
    ) as HTMLButtonElement;
    const freeBtn = dom.querySelector(
      '[data-testid="inspector-finding-fix-30"] button',
    ) as HTMLButtonElement;
    expect(busyBtn.disabled).toBe(true);
    expect(freeBtn.disabled).toBe(false);
  });

  it('an active fix disables the row: wrench, resolve and dismiss all sit disabled', async () => {
    // The finder entry reports a RUNNING job (the fixer union lights it),
    // so the whole row must lock: acting on a finding mid-fix contradicts
    // the fixer already working on it.
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([makeFinding()]),
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({
            fixerIds: ['core/todo-fixer'],
            hasOpenFindings: true,
            state: 'running',
            jobId: 'job-9',
          }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    for (const action of ['fix', 'resolve', 'dismiss']) {
      const btn = dom.querySelector(
        `[data-testid="inspector-finding-${action}-12"] button`,
      ) as HTMLButtonElement;
      expect(btn, action).not.toBeNull();
      expect(btn.disabled, action).toBe(true);
    }
  });

  it('renders finding rows with severity, type, message, provenance, and the dimmed id', async () => {
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([
        makeFinding(),
        makeFinding({ id: 13, severity: 'error', type: 'secret-leak', model: null, confidence: 0.5 }),
      ]),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const rows = dom.querySelectorAll('[data-testid^="inspector-ai-action-1"]');
    const first = dom.querySelector('[data-testid="inspector-ai-action-12"]');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(first).not.toBeNull();
    expect(first!.getAttribute('data-severity')).toBe('warn');
    expect(first!.textContent).toContain('stale-todo');
    expect(first!.textContent).toContain('The TODO at line 4 looks abandoned.');
    expect(first!.textContent).toContain('#12');
    // Provenance: the confidence percent alone (the model was dropped
    // from the row, user call 2026-07-20; the terminal still shows it).
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-provenance-12"]')!.textContent,
    ).toBe('(87%)');
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-provenance-13"]')!.textContent,
    ).toBe('(50%)');
    // Findings without launchers still show the card; no empty state.
    expect(dom.querySelector('[data-testid="inspector-ai-actions-empty"]')).toBeNull();
  });

  it('a stale row rides the DEFAULT tray inline with the stale mark (no stale bucket)', async () => {
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([
        makeFinding(),
        makeFinding({ id: 21, stale: true }),
      ]),
    });
    const dom: HTMLElement = fixture.nativeElement;
    // Both rows render; only the stale one carries the mark.
    expect(dom.querySelector('[data-testid="inspector-ai-action-21"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-finding-stale-21"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inspector-finding-stale-12"]')).toBeNull();
    // And there is no stale reveal chip anymore.
    expect(dom.querySelector('[data-testid="inspector-ai-hidden-stale"]')).toBeNull();
  });

  it('renders no honesty line (the run history lives in Activity, user call 2026-07-17)', async () => {
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([], { total: 3, fixedExcluded: 2, dismissedExcluded: 1 }),
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-ai-actions-hidden"]'),
    ).toBeNull();
  });

  it('keeps the card up on hidden-only counts: the reveal chips are its content', async () => {
    // Flipped when the hidden-buckets chips landed: a hidden-only card now
    // carries the reveal / restore surface, and hiding it would strand an
    // all-dismissed node with no way back from the UI.
    const { fixture } = await bootAiActions({
      findings: makeFindingsEnvelope([], { total: 1, fixedExcluded: 1 }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-ai-actions"]')).not.toBeNull();
    const chip = dom.querySelector('[data-testid="inspector-ai-hidden-fixed"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('1 fixed');
  });

  it('submits the extension on click and flips the button to queued optimistically', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    const host = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/todo-finder', false);
    expect(host.getAttribute('data-state')).toBe('queued');
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-ai-actions-error"]'),
    ).toBeNull();
  });

  it('treats a duplicate-job refusal as already queued (no error banner)', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    dataSource.submitNodeJob.mockRejectedValue(
      new DataSourceError('duplicate-job', 'An identical job is already active.', {
        existingId: 'job-9',
      }),
    );
    const host = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    expect(host.getAttribute('data-state')).toBe('queued');
    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-ai-actions-error"]'),
    ).toBeNull();
  });

  it('renders the advisory plus the sm agent install hint on no-processing-agent', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    dataSource.submitNodeJob.mockRejectedValue(
      new DataSourceError(
        'no-processing-agent',
        'No processing agent skill is installed for this project.',
      ),
    );
    const host = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const error = dom.querySelector('[data-testid="inspector-ai-actions-error"]');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain('No processing agent skill is installed');
    const hint = dom.querySelector('[data-testid="inspector-ai-actions-agent-hint"]');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('sm agent install');
    // The refusal never flips the button: it stays idle and clickable.
    expect(host.getAttribute('data-state')).toBe('idle');
  });

  it('shows the envelope message for other error codes without the agent hint', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    dataSource.submitNodeJob.mockRejectedValue(
      new DataSourceError('node-drifted', 'The node drifted; run sm scan first.'),
    );
    const host = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-error"]')!.textContent,
    ).toContain('The node drifted; run sm scan first.');
    expect(dom.querySelector('[data-testid="inspector-ai-actions-agent-hint"]')).toBeNull();
    // Dismiss clears the banner.
    (
      dom.querySelector(
        '[data-testid="inspector-ai-actions-error-dismiss"]',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-ai-actions-error"]')).toBeNull();
  });

  it('renders queued / running server states as disabled buttons', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [
          makeProbEntry({ id: 'core/a-finder', state: 'queued', jobId: 'job-a' }),
          makeProbEntry({ id: 'core/b-finder', state: 'running', jobId: 'job-b' }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const queued = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/a-finder"]',
    ) as HTMLElement;
    const running = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/b-finder"]',
    ) as HTMLElement;
    expect(queued.getAttribute('data-state')).toBe('queued');
    expect((queued.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(running.getAttribute('data-state')).toBe('running');
    expect((running.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('re-fetches both reads on a job.* frame (debounced live refresh)', async () => {
    const { fixture, dataSource, jobEvents$ } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    const findingsBefore = dataSource.getNodeFindings.mock.calls.length;
    const probsBefore = dataSource.getNodeProbExtensions.mock.calls.length;

    vi.useFakeTimers();
    try {
      jobEvents$.next();
      vi.advanceTimersByTime(400);
    } finally {
      vi.useRealTimers();
    }
    await flush(fixture);

    expect(dataSource.getNodeFindings.mock.calls.length).toBeGreaterThan(findingsBefore);
    expect(dataSource.getNodeProbExtensions.mock.calls.length).toBeGreaterThan(probsBefore);
  });

  // -------------------------------------------------------------------
  // Stop / restart companions (user decision 2026-07-17)
  // -------------------------------------------------------------------

  it('renders no stop/restart companions for an idle entry (jobId null)', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-ai-action-stop-core/todo-finder"]')).toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-restart-core/todo-finder"]'),
    ).toBeNull();
  });

  it('keeps the companions hidden on an optimistic queued flip (no server jobId yet)', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry()] }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const host = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    (host.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    // Optimistically queued, but the server has not confirmed a job
    // handle: nothing to cancel, so no companions until the refresh lands.
    expect(host.getAttribute('data-state')).toBe('queued');
    expect(dom.querySelector('[data-testid="inspector-ai-action-stop-core/todo-finder"]')).toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-restart-core/todo-finder"]'),
    ).toBeNull();
  });

  it('renders the stop companion beside a queued entry that carries a jobId', async () => {
    const { fixture } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ state: 'queued', jobId: 'job-7' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-stop-core/todo-finder"]'),
    ).not.toBeNull();
    // The restart twin was dropped (user call 2026-07-17): never rendered.
    expect(
      dom.querySelector('[data-testid="inspector-ai-action-restart-core/todo-finder"]'),
    ).toBeNull();
  });

  it('stop cancels the active job and flips the launcher to idle optimistically', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ state: 'queued', jobId: 'job-7' })],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const stop = dom.querySelector(
      '[data-testid="inspector-ai-action-stop-core/todo-finder"]',
    ) as HTMLElement;
    (stop.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    expect(dataSource.cancelJob).toHaveBeenCalledWith('job-7');
    const launcher = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    // Optimistic idle: launcher re-enabled, companions gone (the WS
    // frame + debounced refresh confirm server-side).
    expect(launcher.getAttribute('data-state')).toBe('idle');
    expect((launcher.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
    expect(dom.querySelector('[data-testid="inspector-ai-action-stop-core/todo-finder"]')).toBeNull();
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-error"]'),
    ).toBeNull();
  });

  it('treats a job-terminal stop refusal as a silent race: no error, just a re-fetch', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ state: 'queued', jobId: 'job-7' })],
      }),
    });
    dataSource.cancelJob.mockRejectedValue(
      new DataSourceError('job-terminal', 'Job job-7 is already terminal.'),
    );
    const probsBefore = dataSource.getNodeProbExtensions.mock.calls.length;
    const stop = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-stop-core/todo-finder"]',
    ) as HTMLElement;
    (stop.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    await flush(fixture);

    expect(
      fixture.nativeElement.querySelector('[data-testid="inspector-ai-actions-error"]'),
    ).toBeNull();
    // No WS cancel frame is coming for a job that already finished, so
    // the handle re-fetches the authoritative state directly.
    expect(dataSource.getNodeProbExtensions.mock.calls.length).toBeGreaterThan(probsBefore);
  });

  it('surfaces other stop failures in the error strip without flipping the state', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ state: 'queued', jobId: 'job-7' })],
      }),
    });
    dataSource.cancelJob.mockRejectedValue(
      new DataSourceError('not-found', 'No job with id job-7.'),
    );
    const stop = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-stop-core/todo-finder"]',
    ) as HTMLElement;
    (stop.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector('[data-testid="inspector-ai-actions-error"]')!.textContent,
    ).toContain('No job with id job-7.');
    expect(
      (
        dom.querySelector(
          '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
        ) as HTMLElement
      ).getAttribute('data-state'),
    ).toBe('queued');
  });



  it('disables the stop companion while the cancel round-trip is in flight', async () => {
    const { fixture, dataSource } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ state: 'queued', jobId: 'job-7' })],
      }),
    });
    let resolveCancel: () => void = () => undefined;
    dataSource.cancelJob.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        }),
    );
    const dom: HTMLElement = fixture.nativeElement;
    const stop = dom.querySelector(
      '[data-testid="inspector-ai-action-stop-core/todo-finder"]',
    ) as HTMLElement;
    (stop.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);

    expect((stop.querySelector('button') as HTMLButtonElement).disabled).toBe(true);

    resolveCancel();
    await flush(fixture);
    // Settled: the optimistic idle flip retires the companion entirely.
    expect(dom.querySelector('[data-testid="inspector-ai-action-stop-core/todo-finder"]')).toBeNull();
  });

  // -------------------------------------------------------------------
  // Two-state finder button + automatic toggle (Step 16)
  // -------------------------------------------------------------------

  it('renders a finder-without-fixer and a standalone action as single-action buttons', async () => {
    // Both land in the `standalone` bucket (label = short name); clicking
    // either submits its own extension with autoFix false.
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({
        standalone: [
          makeProbEntry({ id: 'core/orphan-finder', description: 'A finder with no fixer.' }),
          makeProbEntry({ id: 'core/summarizer', description: 'Summarizes the node.' }),
        ],
      }),
    });
    const dom: HTMLElement = fixture.nativeElement;
    const summarizer = dom.querySelector(
      '[data-testid="inspector-ai-action-launch-core/summarizer"]',
    ) as HTMLElement;
    expect(summarizer.textContent).toContain('summarizer');
    expect(summarizer.getAttribute('data-action')).toBe('run');
    (summarizer.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/summarizer', false);
  });

  it('shows the automatic toggle only when a finder-with-fixer button exists', async () => {
    const standaloneOnly = await bootAiActions({
      probs: makeProbExtensions({
        standalone: [makeProbEntry({ id: 'core/summarizer', description: 'Summarizes.' })],
      }),
    });
    expect(
      standaloneOnly.fixture.nativeElement.querySelector(
        '[data-testid="inspector-auto-fix-toggle"]',
      ),
    ).toBeNull();

    const withFinder = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })] }),
    });
    expect(
      withFinder.fixture.nativeElement.querySelector('[data-testid="inspector-auto-fix-toggle"]'),
    ).not.toBeNull();
  });

  it('with the automatic toggle ON, one click submits the finder with autoFix true', async () => {
    // The persisted preference is read at init.
    localStorage.setItem('skill-map.ui.inspector.autoFix', 'true');
    const { fixture, dataSource, node } = await bootAiActions({
      probs: makeProbExtensions({
        finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'], hasOpenFindings: false })],
      }),
    });
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    // Automatic flips the action: data-action becomes detectAndFix (the
    // label stays the kind).
    expect(btn.textContent).toContain('todo-finder');
    expect(btn.getAttribute('data-action')).toBe('detectAndFix');
    (btn.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    // Submits the FINDER (not the fixer) with the autoFix flag; the kernel chains.
    expect(dataSource.submitNodeJob).toHaveBeenCalledWith(node.path, 'core/todo-finder', true);
    expect(dataSource.submitNodeJob).not.toHaveBeenCalledWith(
      node.path,
      'core/todo-fixer',
      expect.anything(),
    );
  });

  it('persists the automatic toggle to localStorage (round-trip) and defaults / parses defensively', async () => {
    const KEY = 'skill-map.ui.inspector.autoFix';
    interface IAutoFixProto {
      autoFixEnabled(): boolean;
      onAutoFixToggle(v: boolean): void;
    }

    // Default OFF when unset.
    const fresh = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })] }),
    });
    const proto = fresh.fixture.componentInstance as unknown as IAutoFixProto;
    expect(proto.autoFixEnabled()).toBe(false);

    // Round-trip: a change writes 'true' / 'false' back to storage.
    proto.onAutoFixToggle(true);
    await flush(fresh.fixture);
    expect(localStorage.getItem(KEY)).toBe('true');
    proto.onAutoFixToggle(false);
    await flush(fresh.fixture);
    expect(localStorage.getItem(KEY)).toBe('false');

    // A bogus stored value resolves to false (only the literal 'true' is on).
    localStorage.setItem(KEY, 'yes-please');
    const bogus = await bootAiActions({
      probs: makeProbExtensions({ finders: [makeProbEntry({ fixerIds: ['core/todo-fixer'] })] }),
    });
    expect(
      (bogus.fixture.componentInstance as unknown as IAutoFixProto).autoFixEnabled(),
    ).toBe(false);
    const btn = bogus.fixture.nativeElement.querySelector(
      '[data-testid="inspector-ai-action-launch-core/todo-finder"]',
    ) as HTMLElement;
    expect(btn.getAttribute('data-action')).toBe('detect');
  });

  it('the dismiss X dismisses DIRECTLY (no prompt, no note)', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      findings: makeFindingsEnvelope([makeFinding()]),
    });
    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-finding-dismiss-12"] button',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dataSource.dismissFinding).toHaveBeenCalledWith(node.path, 12, {});
  });

  it('the row X dismisses ONLY this finding: no consent, row-grain body', async () => {
    // 2026-07-22 user decision: the X is a resolution state on the row,
    // not the class suppression, so no `.sm` write and no consent gate.
    const { fixture, dataSource, node } = await bootAiActions({
      findings: makeFindingsEnvelope([makeFinding()]),
    });
    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-finding-dismiss-12"] button',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    const dispatcher = TestBed.inject(ActionDispatchService);
    expect(dispatcher.consentOpen()).toBe(false);
    expect(dataSource.dismissFinding).toHaveBeenCalledWith(node.path, 12, {});
  });


  it('the check mark resolves a finding (fixed by the operator)', async () => {
    const { fixture, dataSource, node } = await bootAiActions({
      findings: makeFindingsEnvelope([makeFinding()]),
    });
    (
      fixture.nativeElement.querySelector(
        '[data-testid="inspector-finding-resolve-12"] button',
      ) as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dataSource.resolveFinding).toHaveBeenCalledWith(node.path, 12);
  });

  it('hidden chips reveal a bucket; restore un-dismisses from the dismissed rows', async () => {
    const hiddenOnly = makeFindingsEnvelope([], { dismissedExcluded: 1 });
    const { fixture, dataSource, node } = await bootAiActions({ findings: hiddenOnly });
    // The card stays up on hidden-only content (the reveal surface).
    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="inspector-card-ai-actions"]')).not.toBeNull();
    const chip = dom.querySelector(
      '[data-testid="inspector-ai-hidden-dismissed"]',
    ) as HTMLButtonElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('1 dismissed');

    // Revealing fetches the bucket rows (the ?dismissed=1 filter).
    dataSource.getNodeFindings.mockImplementation(
      (_path: string, bucket?: string): Promise<IFindingsEnvelopeApi> =>
        Promise.resolve(
          bucket === 'dismissed' ? makeFindingsEnvelope([makeFinding({ id: 33 })]) : hiddenOnly,
        ),
    );
    chip.click();
    await flush(fixture);
    expect(dataSource.getNodeFindings).toHaveBeenCalledWith(node.path, 'dismissed');
    const revealed = dom.querySelector('[data-testid="inspector-ai-revealed-33"]');
    expect(revealed).not.toBeNull();

    // Restore un-dismisses with the row's EXACT class identity.
    (
      dom.querySelector('[data-testid="inspector-finding-restore-33"] button') as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dataSource.undismissFinding).toHaveBeenCalledWith(
      node.path,
      { extension: 'core/todo-finder', type: 'stale-todo' },
      {},
    );
  });

  it('a zero-count chip never renders: emptying the revealed bucket collapses chip + sublist', async () => {
    const hiddenOnly = makeFindingsEnvelope([], { dismissedExcluded: 1 });
    const { fixture, dataSource } = await bootAiActions({ findings: hiddenOnly });
    const dom: HTMLElement = fixture.nativeElement;
    dataSource.getNodeFindings.mockImplementation(
      (_path: string, bucket?: string): Promise<IFindingsEnvelopeApi> =>
        Promise.resolve(
          bucket === 'dismissed' ? makeFindingsEnvelope([makeFinding({ id: 33 })]) : hiddenOnly,
        ),
    );
    (
      dom.querySelector('[data-testid="inspector-ai-hidden-dismissed"]') as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-ai-revealed-33"]')).not.toBeNull();

    // Restoring the LAST row: the refetched counts drop to zero, so the
    // chip disappears and the revealed sublist auto-collapses with it.
    dataSource.getNodeFindings.mockResolvedValue(
      makeFindingsEnvelope([makeFinding({ id: 33 })], { dismissedExcluded: 0 }),
    );
    (
      dom.querySelector('[data-testid="inspector-finding-restore-33"] button') as HTMLButtonElement
    ).click();
    // Two rounds: the restore settles, then its tray refetch lands.
    await flush(fixture);
    await flush(fixture);
    expect(dom.querySelector('[data-testid="inspector-ai-hidden-dismissed"]')).toBeNull();
    expect(dom.querySelector('[data-testid="inspector-ai-revealed-list"]')).toBeNull();
  });

  it('a revealed dismissed row also carries a delete X that hard-deletes the row', async () => {
    const hiddenOnly = makeFindingsEnvelope([], { dismissedExcluded: 1 });
    const { fixture, dataSource, node } = await bootAiActions({ findings: hiddenOnly });
    const dom: HTMLElement = fixture.nativeElement;
    dataSource.getNodeFindings.mockImplementation(
      (_path: string, bucket?: string): Promise<IFindingsEnvelopeApi> =>
        Promise.resolve(
          bucket === 'dismissed' ? makeFindingsEnvelope([makeFinding({ id: 33 })]) : hiddenOnly,
        ),
    );
    (
      dom.querySelector('[data-testid="inspector-ai-hidden-dismissed"]') as HTMLButtonElement
    ).click();
    await flush(fixture);

    (
      dom.querySelector('[data-testid="inspector-finding-delete-33"] button') as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dataSource.deleteFinding).toHaveBeenCalledWith(node.path, 33, {});
  });

  it('revealed fixed rows carry the delete X (no restore) and delete hard-removes', async () => {
    const hiddenOnly = makeFindingsEnvelope([], { fixedExcluded: 1 });
    const { fixture, dataSource, node } = await bootAiActions({ findings: hiddenOnly });
    const dom: HTMLElement = fixture.nativeElement;
    dataSource.getNodeFindings.mockImplementation(
      (_path: string, bucket?: string): Promise<IFindingsEnvelopeApi> =>
        Promise.resolve(
          bucket === 'fixed' ? makeFindingsEnvelope([makeFinding({ id: 44 })]) : hiddenOnly,
        ),
    );
    (
      dom.querySelector('[data-testid="inspector-ai-hidden-fixed"]') as HTMLButtonElement
    ).click();
    await flush(fixture);

    // Fixed rows: delete only, no restore (nothing to un-dismiss).
    expect(dom.querySelector('[data-testid="inspector-finding-restore-44"]')).toBeNull();
    (
      dom.querySelector('[data-testid="inspector-finding-delete-44"] button') as HTMLButtonElement
    ).click();
    await flush(fixture);
    expect(dataSource.deleteFinding).toHaveBeenCalledWith(node.path, 44, {});
  });
});
