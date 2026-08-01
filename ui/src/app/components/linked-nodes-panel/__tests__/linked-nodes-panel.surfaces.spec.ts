import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { EMPTY, Subject } from 'rxjs';

import { LinkedNodesPanel } from '../linked-nodes-panel';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { WsEventStreamService } from '../../../../services/ws-event-stream';
import type {
  IExternalRefApi,
  IIssueApi,
  ILinkApi,
  IListEnvelopeApi,
  INodeDetailApi,
} from '../../../../models/api';
import type { IWsScanCompletedEvent } from '../../../../models/ws-event';

/**
 * `LinkedNodesPanel` visual-surfaces spec, complements
 * `linked-nodes-panel.spec.ts` (lifecycle / state machine). Covers:
 *
 *   - inline issue chip on outgoing rows, source-side ONLY (an issue
 *     that lives on the inspected node and names this edge). Issues that
 *     live on the neighbour (target / incoming source) are NOT surfaced.
 *   - external references section (link href, no line label)
 *   - self-loop filter (`outgoingRaw` keeps them, `outgoing` drops them)
 *   - numeric confidence value rendered in the confidence chip
 *
 * The panel fans out four parallel data-source calls (`listLinks` x2,
 * `listIssues`, `getNode`); the helper below stubs all four with
 * shape-correct envelopes so a typed-strict consumer is never surprised
 * by a missing field.
 */

type IStubDataSource = IDataSourcePort & {
  listLinks: ReturnType<typeof vi.fn>;
  listIssues: ReturnType<typeof vi.fn>;
  getNode: ReturnType<typeof vi.fn>;
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

function envelope<T>(items: T[]): IListEnvelopeApi<T> {
  return {
    schemaVersion: '1',
    kind: 'links',
    items,
    filters: { kind: null, from: null, to: null },
    counts: { total: items.length, returned: items.length },
    kindRegistry: {},
  };
}

function issueEnvelope(items: IIssueApi[]): IListEnvelopeApi<IIssueApi> {
  return {
    schemaVersion: '1',
    kind: 'issues',
    items,
    filters: {},
    counts: { total: items.length, returned: items.length },
    kindRegistry: {},
  };
}

function nodeDetail(path: string, externalRefs: IExternalRefApi[]): INodeDetailApi {
  return {
    schemaVersion: '1',
    kind: 'node',
    item: {
      path,
      kind: 'note',
      provider: 'core',
      bodyHash: 'sha256:0',
      frontmatterHash: 'sha256:0',
      bytes: { frontmatter: 0, body: 0, total: 0 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: externalRefs.length,
      externalRefs,
    },
    links: { incoming: [], outgoing: [] },
    issues: [],
    kindRegistry: {},
  };
}

function makeStub(): IStubDataSource {
  return {
    health: vi.fn(),
    loadScan: vi.fn(),
    listNodes: vi.fn(),
    getNode: vi.fn().mockResolvedValue(null),
    listLinks: vi.fn().mockResolvedValue(envelope([])),
    listIssues: vi.fn().mockResolvedValue(issueEnvelope([])),
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
  // Three microtask ticks cover the two-phase fetch (links + getNode →
  // derive `nodes` → narrowed listIssues). See the sibling spec's
  // `flush` for the same rationale.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('LinkedNodesPanel · inline issue chip on rows', () => {
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

  it('outgoing row renders an issue chip when the focused node has a source-side broken-ref naming the link target', async () => {
    const focused = 'src.md';
    const linkTarget = 'dst.md';
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === focused) {
        return Promise.resolve(envelope([makeLink({ source: focused, target: linkTarget })]));
      }
      return Promise.resolve(envelope([]));
    });
    const brokenRef: IIssueApi = {
      analyzerId: 'core/broken-ref',
      severity: 'error',
      nodeIds: [focused],
      message: 'Broken reference to dst.md',
      data: { target: linkTarget },
    };
    stub.listIssues.mockResolvedValue(issueEnvelope([brokenRef]));

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const chip = dom.querySelector(
      `[data-testid="linked-nodes-outgoing-issue-${linkTarget}"]`,
    );
    expect(chip).not.toBeNull();
    // The chip is a plain span carrying the analyzer id as text and the
    // raw severity on `data-severity` (drives the outlined colour).
    expect(chip!.textContent).toContain('core/broken-ref');
    expect(chip!.getAttribute('data-severity')).toBe('error');
  });

  it('outgoing row does NOT surface an issue that lives only on the target node', async () => {
    const focused = 'src.md';
    const linkTarget = 'dst.md';
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === focused) {
        return Promise.resolve(envelope([makeLink({ source: focused, target: linkTarget })]));
      }
      return Promise.resolve(envelope([]));
    });
    // Issue is attached to the TARGET (dst.md), not the focused source:
    // it describes the neighbour, not the node being inspected, so the
    // row must NOT show it (the operator sees it by navigating to dst).
    const reservedOnTarget: IIssueApi = {
      analyzerId: 'core/reserved-name',
      severity: 'warn',
      nodeIds: [linkTarget],
      message: 'dst.md shadows a runtime built-in',
    };
    stub.listIssues.mockResolvedValue(issueEnvelope([reservedOnTarget]));

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    expect(
      dom.querySelector(`[data-testid="linked-nodes-outgoing-issue-${linkTarget}"]`),
    ).toBeNull();
    // The row itself still renders.
    expect(
      dom.querySelector(`[data-testid="linked-nodes-outgoing-row-${linkTarget}"]`),
    ).not.toBeNull();
  });

  it('incoming rows never render an issue chip (those issues live on the neighbour)', async () => {
    const focused = 'me.md';
    const incomingSrc = 'caller.md';
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.to === focused) {
        return Promise.resolve(
          envelope([makeLink({ source: incomingSrc, target: focused })]),
        );
      }
      return Promise.resolve(envelope([]));
    });
    const onSource: IIssueApi = {
      analyzerId: 'core/broken-ref',
      severity: 'error',
      nodeIds: [incomingSrc],
      message: 'caller.md points at a stale name',
      data: { target: focused },
    };
    stub.listIssues.mockResolvedValue(issueEnvelope([onSource]));

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    // The incoming row renders, but with no issue chip.
    expect(
      dom.querySelector(`[data-testid="linked-nodes-incoming-row-${incomingSrc}"]`),
    ).not.toBeNull();
    expect(
      dom.querySelector(`[data-testid="linked-nodes-incoming-issue-${incomingSrc}"]`),
    ).toBeNull();
  });

  it('omits the chip on a row whose source and target both lack a matching issue', async () => {
    const focused = 'src.md';
    const linkTarget = 'clean.md';
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === focused) {
        return Promise.resolve(envelope([makeLink({ source: focused, target: linkTarget })]));
      }
      return Promise.resolve(envelope([]));
    });
    // Issue exists on the source node, but it names a DIFFERENT edge.
    // The chip-resolver guards against bleed: only source-side issues
    // whose `data.target` matches the row's target should surface.
    const otherEdge: IIssueApi = {
      analyzerId: 'core/broken-ref',
      severity: 'error',
      nodeIds: [focused],
      message: 'Broken reference to some-other.md',
      data: { target: 'some-other.md' },
    };
    stub.listIssues.mockResolvedValue(issueEnvelope([otherEdge]));

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const chip = dom.querySelector(
      `[data-testid="linked-nodes-outgoing-issue-${linkTarget}"]`,
    );
    expect(chip).toBeNull();
    // The row itself should still render.
    expect(
      dom.querySelector(`[data-testid="linked-nodes-outgoing-row-${linkTarget}"]`),
    ).not.toBeNull();
  });
});

describe('LinkedNodesPanel · external references section', () => {
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

  it('renders one row per external URL with the right href and line label', async () => {
    const focused = 'note.md';
    const refs: IExternalRefApi[] = [
      { url: 'https://example.com/a', line: 12, originalTrigger: 'https://example.com/a' },
      { url: 'https://example.com/b', originalTrigger: 'https://example.com/b' },
    ];
    stub.getNode.mockResolvedValue(nodeDetail(focused, refs));

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const section = dom.querySelector('[data-testid="linked-nodes-external-refs"]');
    expect(section).not.toBeNull();

    const a = section!.querySelector(
      '[data-testid="linked-nodes-external-ref-https://example.com/a"]',
    );
    const b = section!.querySelector(
      '[data-testid="linked-nodes-external-ref-https://example.com/b"]',
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    // Each entry is a single clickable anchor (line numbers are no
    // longer shown).
    const anchorA = a!.querySelector('a');
    expect(anchorA?.getAttribute('href')).toBe('https://example.com/a');
    expect(anchorA?.getAttribute('target')).toBe('_blank');
    expect(anchorA?.getAttribute('rel')).toBe('noopener noreferrer');

    const anchorB = b!.querySelector('a');
    expect(anchorB?.getAttribute('href')).toBe('https://example.com/b');
  });

  it('omits the external-refs section entirely when the node has no URLs', async () => {
    const focused = 'note.md';
    stub.getNode.mockResolvedValue(nodeDetail(focused, []));

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    expect(dom.querySelector('[data-testid="linked-nodes-external-refs"]')).toBeNull();
  });

  // Audit `app-hacker` M-2, URL-scheme allowlist on `[href]` for
  // external refs. The kernel extracts URLs verbatim from markdown
  // bodies, so a malicious sidecar / note can plant a `data:`,
  // `file:`, or `vbscript:` URL the SPA would otherwise bind into the
  // anchor. Filter at the computed signal level so the row is dropped
  // entirely rather than rendered with a sanitized-away href.
  it('audit M-2, drops external refs whose scheme is not http(s)', async () => {
    const focused = 'note.md';
    const refs: IExternalRefApi[] = [
      { url: 'https://example.com/safe', originalTrigger: 'https://example.com/safe' },
      { url: 'data:text/html,<script>alert(1)</script>', originalTrigger: 'data:...' },
      { url: 'file:///etc/passwd', originalTrigger: 'file:///etc/passwd' },
      { url: 'vbscript:msgbox(1)', originalTrigger: 'vbscript:msgbox(1)' },
      { url: 'http://example.com/plain', originalTrigger: 'http://example.com/plain' },
    ];
    stub.getNode.mockResolvedValue(nodeDetail(focused, refs));

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const section = dom.querySelector('[data-testid="linked-nodes-external-refs"]');
    expect(section).not.toBeNull();

    // Only the two http(s) entries survive.
    const rows = section!.querySelectorAll(
      '[data-testid^="linked-nodes-external-ref-"]',
    );
    expect(rows.length).toBe(2);
    expect(
      section!.querySelector(
        '[data-testid="linked-nodes-external-ref-https://example.com/safe"]',
      ),
    ).not.toBeNull();
    expect(
      section!.querySelector(
        '[data-testid="linked-nodes-external-ref-http://example.com/plain"]',
      ),
    ).not.toBeNull();

    // None of the rejected schemes leak into the DOM at all (no row, no anchor).
    const html = section!.outerHTML.toLowerCase();
    expect(html).not.toContain('data:text/html');
    expect(html).not.toContain('file:///');
    expect(html).not.toContain('vbscript:');
  });
});

describe('LinkedNodesPanel · self-loop filter', () => {
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

  it('hides self-loop edges from the outgoing list (direct source===target and resolvedTarget match)', async () => {
    const focused = 'self.md';
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === focused) {
        return Promise.resolve(
          envelope([
            // Direct self-loop: source === target.
            makeLink({ source: focused, target: focused, kind: 'references' }),
            // Trigger-style self-loop: target is the literal handle, but
            // `resolvedTarget` lifted it back to the source node.
            makeLink({
              source: focused,
              target: '@self',
              resolvedTarget: focused,
              kind: 'mentions',
            }),
            // Healthy outgoing edge, must remain visible.
            makeLink({ source: focused, target: 'real.md', kind: 'references' }),
          ]),
        );
      }
      return Promise.resolve(envelope([]));
    });

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    // Healthy edge renders.
    expect(
      dom.querySelector('[data-testid="linked-nodes-outgoing-row-real.md"]'),
    ).not.toBeNull();
    // Direct self-loop hidden.
    expect(
      dom.querySelector(`[data-testid="linked-nodes-outgoing-row-${focused}"]`),
    ).toBeNull();
    // Resolved self-loop hidden.
    expect(
      dom.querySelector('[data-testid="linked-nodes-outgoing-row-@self"]'),
    ).toBeNull();
  });
});

describe('LinkedNodesPanel · numeric confidence', () => {
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

  it('renders the numeric confidence value (two decimals) and surfaces the qualitative tier through the tag binding', async () => {
    const focused = 'src.md';
    const linkTarget = 'dst.md';
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === focused) {
        return Promise.resolve(
          envelope([
            makeLink({ source: focused, target: linkTarget, confidence: 0.85 }),
          ]),
        );
      }
      return Promise.resolve(envelope([]));
    });

    const { fixture, cmp } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const row = dom.querySelector(
      `[data-testid="linked-nodes-outgoing-row-${linkTarget}"]`,
    );
    expect(row).not.toBeNull();
    // The confidence chip renders the two-decimal value as its text.
    const chipLabels = Array.from(
      row!.querySelectorAll('.linked-nodes-panel__chip'),
    ).map((c) => c.textContent?.trim() ?? '');
    expect(chipLabels).toContain('0.85');
    // The tooltip string is built from the qualitative tier (`high` for
    // 0.85 >= 0.75). Asserting the helper directly because pTooltip is a
    // directive and does not surface the string in the rendered DOM
    // under jsdom.
    expect(
      (cmp as unknown as { confidenceTooltip(c: number): string }).confidenceTooltip(0.85),
    ).toBe('confidence: high');
  });
});

describe('LinkedNodesPanel · section count headers', () => {
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

  it('renders each section header with the card icon vocabulary and the live count', async () => {
    const focused = 'center.md';
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === focused) {
        return Promise.resolve(
          envelope([
            makeLink({ source: focused, target: 'out-1.md' }),
            makeLink({ source: focused, target: 'out-2.md' }),
          ]),
        );
      }
      if (q.to === focused) {
        return Promise.resolve(envelope([makeLink({ source: 'in-1.md', target: focused })]));
      }
      return Promise.resolve(envelope([]));
    });
    stub.getNode.mockResolvedValue(
      nodeDetail(focused, [
        { url: 'https://example.com/a', line: 12, originalTrigger: 'https://example.com/a' },
        { url: 'https://example.com/b', originalTrigger: 'https://example.com/b' },
      ]),
    );

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;

    // Outgoing: pi-upload glyph + count 2 (mirrors the card's `linksOut`).
    const out = dom.querySelector('[data-testid="linked-nodes-outgoing"]')!;
    expect(out.querySelector('i.pi-upload')).not.toBeNull();
    expect(
      out.querySelector('[data-testid="linked-nodes-outgoing-count"]')?.textContent?.trim(),
    ).toBe('2');

    // Incoming: pi-download glyph + count 1 (mirrors the card's `linksIn`).
    const inc = dom.querySelector('[data-testid="linked-nodes-incoming"]')!;
    expect(inc.querySelector('i.pi-download')).not.toBeNull();
    expect(
      inc.querySelector('[data-testid="linked-nodes-incoming-count"]')?.textContent?.trim(),
    ).toBe('1');

    // External: pi-link glyph + count 2 (mirrors the card's external-url counter).
    const ext = dom.querySelector('[data-testid="linked-nodes-external-refs"]')!;
    expect(ext.querySelector('i.pi-link')).not.toBeNull();
    expect(
      ext.querySelector('[data-testid="linked-nodes-external-count"]')?.textContent?.trim(),
    ).toBe('2');
  });

  it('omits a direction section entirely when it has no links', async () => {
    // Default stub: every listLinks resolves empty and getNode has no refs.
    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', 'lonely.md');
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    // Empty directions (and external refs) render no section at all, so
    // no header / count appears for any of them.
    expect(dom.querySelector('[data-testid="linked-nodes-outgoing"]')).toBeNull();
    expect(dom.querySelector('[data-testid="linked-nodes-incoming"]')).toBeNull();
    expect(dom.querySelector('[data-testid="linked-nodes-external-refs"]')).toBeNull();
  });
});
