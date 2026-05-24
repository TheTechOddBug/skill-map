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
 * `linked-nodes-panel.spec.ts` (lifecycle / state machine). Covers
 * the five affordances added in commits d207cfa + 21920e8:
 *
 *   - findings list (severity tag colours + empty state)
 *   - inline issue chip on outgoing rows (source-match + target-fallback)
 *   - inline issue chip on incoming rows (source-match)
 *   - per-row occurrences sub-list (rendered for >=1 occurrence)
 *   - external references section (link href + line label)
 *   - self-loop filter (`outgoingRaw` keeps them, `outgoing` drops them)
 *   - numeric confidence (`p-tag` value + qualitative tooltip)
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
    sidecarBumped$: EMPTY,
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

describe('LinkedNodesPanel · findings section', () => {
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

  it('renders findings filtered to the focused node with the right severity tag', async () => {
    const focused = 'center.md';
    stub.listIssues.mockResolvedValue(
      issueEnvelope([
        {
          analyzerId: 'core/broken-ref',
          severity: 'error',
          nodeIds: [focused],
          message: 'Target not found: @ghost',
          data: { target: '@ghost' },
        },
        {
          analyzerId: 'core/reserved-name',
          severity: 'warn',
          nodeIds: [focused],
          message: 'Shadows a runtime built-in',
        },
        // Issue attached to a DIFFERENT node, must not appear.
        {
          analyzerId: 'core/orphan',
          severity: 'info',
          nodeIds: ['other.md'],
          message: 'Orphan node',
        },
      ]),
    );

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const section = dom.querySelector('[data-testid="linked-nodes-findings"]');
    expect(section).not.toBeNull();

    // Both attached issues render; the orphan one does not.
    const rows = section!.querySelectorAll('[data-testid^="linked-nodes-finding-"]');
    expect(rows.length).toBe(2);
    expect(section!.querySelector('[data-testid="linked-nodes-finding-core/broken-ref"]')).not.toBeNull();
    expect(section!.querySelector('[data-testid="linked-nodes-finding-core/reserved-name"]')).not.toBeNull();
    expect(section!.querySelector('[data-testid="linked-nodes-finding-core/orphan"]')).toBeNull();

    // The severity tags carry the right PrimeNG severity via `data-p`.
    // `error` -> 'danger', `warn` -> 'warn' (see `issueSeverity`).
    const brokenTag = section!.querySelector(
      '[data-testid="linked-nodes-finding-core/broken-ref"] p-tag',
    );
    const reservedTag = section!.querySelector(
      '[data-testid="linked-nodes-finding-core/reserved-name"] p-tag',
    );
    expect(brokenTag?.getAttribute('data-p') ?? '').toContain('danger');
    expect(reservedTag?.getAttribute('data-p') ?? '').toContain('warn');

    // The full analyzer message renders inline next to the tag.
    expect(section!.textContent).toContain('Target not found: @ghost');
    expect(section!.textContent).toContain('Shadows a runtime built-in');
  });

  it('renders the empty-state text when no issue is attached to the focused node', async () => {
    stub.listIssues.mockResolvedValue(
      issueEnvelope([
        {
          analyzerId: 'core/orphan',
          severity: 'info',
          nodeIds: ['other.md'],
          message: 'Orphan node',
        },
      ]),
    );

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', 'center.md');
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const section = dom.querySelector('[data-testid="linked-nodes-findings"]');
    expect(section).not.toBeNull();
    const empty = section!.querySelector('[data-testid="linked-nodes-findings-empty"]');
    expect(empty).not.toBeNull();
    // Wording is centralised in the i18n catalog; assert the literal so
    // a refactor that silently swaps the text trips the spec.
    expect(empty?.textContent).toContain('No findings on this node.');
  });
});

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
    // PrimeNG renders the `value` input inside the tag, the analyzer id
    // ends up in the text content.
    expect(chip!.textContent).toContain('core/broken-ref');
    // `error` -> 'danger' on the host's `data-p` attribute.
    expect(chip!.getAttribute('data-p') ?? '').toContain('danger');
  });

  it('outgoing row falls back to a target-side issue when no source-side match exists', async () => {
    const focused = 'src.md';
    const linkTarget = 'dst.md';
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === focused) {
        return Promise.resolve(envelope([makeLink({ source: focused, target: linkTarget })]));
      }
      return Promise.resolve(envelope([]));
    });
    // Issue is attached to the TARGET (dst.md), not the focused source.
    // No `data.target` (pure node-attribute), so the fallback branch
    // (`onTarget`) must pick it up.
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
    const chip = dom.querySelector(
      `[data-testid="linked-nodes-outgoing-issue-${linkTarget}"]`,
    );
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('core/reserved-name');
    expect(chip!.getAttribute('data-p') ?? '').toContain('warn');
  });

  it('incoming row renders an issue chip when the SOURCE node has a broken-ref naming the focused path', async () => {
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
    const chip = dom.querySelector(
      `[data-testid="linked-nodes-incoming-issue-${incomingSrc}"]`,
    );
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('core/broken-ref');
    expect(chip!.getAttribute('data-p') ?? '').toContain('danger');
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

describe('LinkedNodesPanel · occurrences sub-list', () => {
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

  it('renders a sub-list with every occurrence label when a link carries multiple sites', async () => {
    const focused = 'src.md';
    const linkTarget = 'dst.md';
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === focused) {
        return Promise.resolve(
          envelope([
            makeLink({
              source: focused,
              target: linkTarget,
              occurrences: [
                {
                  extractor: 'core/markdown-link',
                  originalTrigger: '[dst](dst.md)',
                  location: { line: 12 },
                },
                {
                  extractor: 'claude/at-directive',
                  originalTrigger: '@dst',
                  location: null,
                },
              ],
            }),
          ]),
        );
      }
      return Promise.resolve(envelope([]));
    });

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const sub = dom.querySelector(
      `[data-testid="linked-nodes-occurrences-${linkTarget}"]`,
    );
    expect(sub).not.toBeNull();
    const items = sub!.querySelectorAll('.linked-nodes-panel__occurrences-item');
    expect(items.length).toBe(2);
    // Templated label, with-line variant for the markdown-link entry.
    expect(items[0]?.textContent).toContain('line 12');
    expect(items[0]?.textContent).toContain('[dst](dst.md)');
    expect(items[0]?.textContent).toContain('core/markdown-link');
    // Unknown-line variant for the at-directive entry (no location).
    expect(items[1]?.textContent).toContain('@dst');
    expect(items[1]?.textContent).toContain('claude/at-directive');
    expect(items[1]?.textContent ?? '').not.toContain('line ');
  });

  it('renders the sub-list even when the link has a single occurrence (>= 1 site)', async () => {
    const focused = 'src.md';
    const linkTarget = 'dst.md';
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === focused) {
        return Promise.resolve(
          envelope([
            makeLink({
              source: focused,
              target: linkTarget,
              occurrences: [
                {
                  extractor: 'core/markdown-link',
                  originalTrigger: '[dst](dst.md)',
                  location: { line: 7 },
                },
              ],
            }),
          ]),
        );
      }
      return Promise.resolve(envelope([]));
    });

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const sub = dom.querySelector(
      `[data-testid="linked-nodes-occurrences-${linkTarget}"]`,
    );
    expect(sub).not.toBeNull();
    const items = sub!.querySelectorAll('.linked-nodes-panel__occurrences-item');
    expect(items.length).toBe(1);
  });

  it('omits the sub-list when the link has no occurrences array', async () => {
    const focused = 'src.md';
    const linkTarget = 'dst.md';
    stub.listLinks.mockImplementation((q: { from?: string; to?: string }) => {
      if (q.from === focused) {
        return Promise.resolve(
          envelope([makeLink({ source: focused, target: linkTarget })]),
        );
      }
      return Promise.resolve(envelope([]));
    });

    const { fixture } = bootstrap(stub, ws);
    fixture.componentRef.setInput('path', focused);
    await flush(fixture);

    const dom: HTMLElement = fixture.nativeElement;
    const sub = dom.querySelector(
      `[data-testid="linked-nodes-occurrences-${linkTarget}"]`,
    );
    expect(sub).toBeNull();
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

    // Anchor for entry with known line.
    const anchorA = a!.querySelector('a');
    expect(anchorA?.getAttribute('href')).toBe('https://example.com/a');
    expect(anchorA?.getAttribute('target')).toBe('_blank');
    expect(anchorA?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a!.textContent).toContain('line 12');

    // Entry without `line` falls back to the unknown-line label.
    const anchorB = b!.querySelector('a');
    expect(anchorB?.getAttribute('href')).toBe('https://example.com/b');
    expect(b!.textContent).toContain('unknown line');
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
    const tags = row!.querySelectorAll('p-tag');
    // Row has at least: kind tag + confidence tag.
    expect(tags.length).toBeGreaterThanOrEqual(2);
    // The confidence tag carries the numeric value as its rendered label.
    const labels = Array.from(tags).map((t) => t.textContent?.trim() ?? '');
    expect(labels).toContain('0.85');
    // The qualitative tier (`high` here, since 0.85 >= 0.75) is the
    // value the component computes for the tooltip binding. Asserting
    // the helper directly because pTooltip is a directive and does not
    // surface the string in the rendered DOM under jsdom.
    expect(
      (cmp as unknown as { confidenceLabel(c: number): string }).confidenceLabel(0.85),
    ).toBe('high');
  });
});
