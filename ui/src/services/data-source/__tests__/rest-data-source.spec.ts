import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';

import { DataSourceError } from '../data-source.port';
import { RestDataSource, __testHooks } from '../rest-data-source';
import { encodeNodePath } from '../path-codec';
import { KindRegistryService } from '../../kind-registry';
import { ProviderRegistryService } from '../../provider-registry';
import { ContributionsRegistryService } from '../../../app/services/contributions-registry';
import { WsEventStreamService } from '../../ws-event-stream';
import type { IWsEvent } from '../../../models/ws-event';

function makeFakeRegistry(): KindRegistryService {
  return { ingest: vi.fn() } as unknown as KindRegistryService;
}

function makeFakeProviderRegistry(): ProviderRegistryService {
  return { ingest: vi.fn() } as unknown as ProviderRegistryService;
}

const HEALTH_FIXTURE = {
  ok: true,
  schemaVersion: '1',
  specVersion: '0.11.0',
  implVersion: '0.9.0',
  db: 'present' as const,
  cwd: '/tmp/test',
  dbPath: '/tmp/test/.skill-map/scan.db',
  mcp: false,
};

const SCAN_FIXTURE = {
  schemaVersion: 1,
  scannedAt: 1700000000000,
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
};

const NODES_ENVELOPE = {
  schemaVersion: '1',
  kind: 'nodes',
  items: [{ path: 'a.md' }],
  filters: { kind: null, hasIssues: null, path: null },
  counts: { total: 1, returned: 1, page: { offset: 0, limit: 100 } },
  kindRegistry: {},
};

const NODE_DETAIL = {
  schemaVersion: '1',
  kind: 'node',
  item: { path: 'a.md' },
  links: { incoming: [], outgoing: [] },
  issues: [],
  kindRegistry: {},
};

describe('RestDataSource', () => {
  let httpMock: HttpTestingController;
  let ds: RestDataSource;
  let wsSubject: Subject<IWsEvent>;
  let fakeWs: WsEventStreamService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    wsSubject = new Subject<IWsEvent>();
    fakeWs = {
      events$: wsSubject.asObservable(),
      disconnect: vi.fn(),
    } as unknown as WsEventStreamService;
    ds = new RestDataSource(
      TestBed.inject(HttpClient),
      fakeWs,
      makeFakeRegistry(),
      new ContributionsRegistryService(),
      makeFakeProviderRegistry(),
    );
  });

  afterEach(() => {
    httpMock.verify();
    wsSubject.complete();
  });

  it('health() GETs /api/health and returns the body', async () => {
    const promise = ds.health();
    const req = httpMock.expectOne('/api/health');
    expect(req.request.method).toBe('GET');
    req.flush(HEALTH_FIXTURE);
    await expect(promise).resolves.toEqual(HEALTH_FIXTURE);
  });

  it('loadScan() GETs /api/scan and returns the ScanResult', async () => {
    const promise = ds.loadScan();
    // Step 14.5.d: loadScan also primes the kindRegistry via a parallel
    // /api/nodes?limit=0 request. Both must be matched so httpMock.verify()
    // doesn't see an outstanding request in afterEach.
    const scanReq = httpMock.expectOne('/api/scan');
    const primeReq = httpMock.expectOne('/api/nodes?limit=0');
    scanReq.flush(SCAN_FIXTURE);
    primeReq.flush(NODES_ENVELOPE);
    await expect(promise).resolves.toEqual(SCAN_FIXTURE);
  });

  it('loadScanMeta() GETs /api/scan?meta=1 and returns the ScanResult', async () => {
    const promise = ds.loadScanMeta();
    const req = httpMock.expectOne('/api/scan?meta=1');
    expect(req.request.method).toBe('GET');
    req.flush(SCAN_FIXTURE);
    await expect(promise).resolves.toEqual(SCAN_FIXTURE);
  });

  it('loadFolders() GETs /api/folders, ingests the registry, returns items', async () => {
    const promise = ds.loadFolders();
    const req = httpMock.expectOne('/api/folders');
    expect(req.request.method).toBe('GET');
    req.flush({
      schemaVersion: '1',
      kind: 'folders',
      items: [
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
          errorCount: 2,
          warnCount: 1,
        },
      ],
      filters: {},
      counts: { total: 2, returned: 2 },
      kindRegistry: {},
    });
    // The four scalar node columns pass straight through the envelope.
    await expect(promise).resolves.toEqual([
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
        errorCount: 2,
        warnCount: 1,
      },
    ]);
  });

  it('loadBranch with an empty scope GETs /api/branch with no params (whole corpus)', async () => {
    const promise = ds.loadBranch({ include: [], exclude: [], excludeRoot: false });
    const req = httpMock.expectOne('/api/branch');
    expect(req.request.method).toBe('GET');
    const payload = {
      schemaVersion: '1',
      kind: 'branch',
      branch: { paths: [], excluded: [], rootExcluded: false, total: 0, rendered: 0, truncated: false, cap: 256 },
      nodes: [],
      links: [],
      issues: [],
    };
    req.flush(payload);
    await expect(promise).resolves.toEqual(payload);
  });

  it('encodes includes, excludes and the root override into the query string', async () => {
    const promise = ds.loadBranch({
      include: ['src/api', 'docs'],
      exclude: ['src/api/legacy'],
      excludeRoot: true,
    });
    const req = httpMock.expectOne(
      '/api/branch?path=src%2Fapi&path=docs&exclude=src%2Fapi%2Flegacy&excludeRoot=1',
    );
    expect(req.request.method).toBe('GET');
    req.flush({
      schemaVersion: '1',
      kind: 'branch',
      branch: { paths: ['src/api', 'docs'], excluded: ['src/api/legacy'], rootExcluded: true, total: 12, rendered: 12, truncated: false, cap: 256 },
      nodes: [],
      links: [],
      issues: [],
    });
    await expect(promise).resolves.toMatchObject({ branch: { paths: ['src/api', 'docs'] } });
  });

  it('omits excludeRoot when false and encodes the limit', async () => {
    const promise = ds.loadBranch({ include: [], exclude: ['noise'], excludeRoot: false }, 50);
    const req = httpMock.expectOne('/api/branch?exclude=noise&limit=50');
    expect(req.request.method).toBe('GET');
    req.flush({
      schemaVersion: '1',
      kind: 'branch',
      branch: { paths: [], excluded: ['noise'], rootExcluded: false, total: 80, rendered: 50, truncated: true, cap: 50 },
      nodes: [],
      links: [],
      issues: [],
    });
    await expect(promise).resolves.toMatchObject({ branch: { truncated: true, cap: 50 } });
  });

  it('listNodes() builds a query string with kinds + hasIssues + pagination', async () => {
    const promise = ds.listNodes({
      kind: ['agent', 'skill'],
      hasIssues: true,
      limit: 50,
      offset: 100,
    });
    const req = httpMock.expectOne(
      '/api/nodes?kind=agent%2Cskill&hasIssues=true&limit=50&offset=100',
    );
    req.flush(NODES_ENVELOPE);
    await expect(promise).resolves.toEqual(NODES_ENVELOPE);
  });

  it('listNodes() omits the query string when no filters are present', async () => {
    const promise = ds.listNodes();
    const req = httpMock.expectOne('/api/nodes');
    req.flush(NODES_ENVELOPE);
    await promise;
  });

  it('getNode() encodes the path and returns the detail bundle', async () => {
    const path = '.claude/agents/foo.md';
    const encoded = encodeNodePath(path);
    const promise = ds.getNode(path);
    const req = httpMock.expectOne(`/api/nodes/${encoded}`);
    req.flush(NODE_DETAIL);
    await expect(promise).resolves.toEqual(NODE_DETAIL);
  });

  it('getNode() returns null on 404 with not-found envelope', async () => {
    const promise = ds.getNode('missing.md');
    const encoded = encodeNodePath('missing.md');
    const req = httpMock.expectOne(`/api/nodes/${encoded}`);
    req.flush(
      { ok: false, error: { code: 'not-found', message: 'no such node' } },
      { status: 404, statusText: 'Not Found' },
    );
    await expect(promise).resolves.toBeNull();
  });

  it('getNodeFindings() GETs the findings sub-route and returns the envelope', async () => {
    const path = '.claude/agents/foo.md';
    const encoded = encodeNodePath(path);
    const envelope = {
      schemaVersion: '1',
      kind: 'findings',
      items: [{ id: 12, type: 'stale-todo', severity: 'warn' }],
      filters: {},
      counts: { total: 1, returned: 1, dismissedExcluded: 0, fixedExcluded: 2 },
      kindRegistry: {},
    };
    const promise = ds.getNodeFindings(path);
    const req = httpMock.expectOne(`/api/nodes/${encoded}/findings`);
    expect(req.request.method).toBe('GET');
    req.flush(envelope);
    await expect(promise).resolves.toEqual(envelope);
  });

  it('getNodeFindings() returns null on 404 not-found', async () => {
    const encoded = encodeNodePath('missing.md');
    const promise = ds.getNodeFindings('missing.md');
    const req = httpMock.expectOne(`/api/nodes/${encoded}/findings`);
    req.flush(
      { ok: false, error: { code: 'not-found', message: 'no such node' } },
      { status: 404, statusText: 'Not Found' },
    );
    await expect(promise).resolves.toBeNull();
  });

  it('getNodeProbExtensions() GETs the prob-extensions sub-route and unwraps the item', async () => {
    const path = 'agents/architect.md';
    const encoded = encodeNodePath(path);
    const item = {
      finders: [
        {
          id: 'core/todo-finder',
          description: 'd',
          state: 'idle',
          jobId: null,
          lastJudged: null,
          fixerIds: ['core/todo-fixer'],
          hasOpenFindings: false,
        },
      ],
      standalone: [],
    };
    const promise = ds.getNodeProbExtensions(path);
    const req = httpMock.expectOne(`/api/nodes/${encoded}/prob-extensions`);
    expect(req.request.method).toBe('GET');
    req.flush({
      schemaVersion: '1',
      kind: 'node.prob-extensions',
      item,
      kindRegistry: {},
    });
    await expect(promise).resolves.toEqual(item);
  });

  it('getNodeProbExtensions() returns null on 404 not-found', async () => {
    const encoded = encodeNodePath('missing.md');
    const promise = ds.getNodeProbExtensions('missing.md');
    const req = httpMock.expectOne(`/api/nodes/${encoded}/prob-extensions`);
    req.flush(
      { ok: false, error: { code: 'not-found', message: 'no such node' } },
      { status: 404, statusText: 'Not Found' },
    );
    await expect(promise).resolves.toBeNull();
  });

  it('submitNodeJob() POSTs the extension body and returns the job.submitted envelope', async () => {
    const path = 'agents/architect.md';
    const encoded = encodeNodePath(path);
    const envelope = {
      schemaVersion: '1',
      kind: 'job.submitted',
      value: {
        jobId: 'job-7',
        nodePath: path,
        extensionId: 'core/todo-finder',
        supersededIds: [],
      },
      elapsedMs: 4,
    };
    const promise = ds.submitNodeJob(path, 'core/todo-finder');
    const req = httpMock.expectOne(`/api/nodes/${encoded}/jobs`);
    expect(req.request.method).toBe('POST');
    // Default autoFix false rides the body alongside the extension id.
    expect(req.request.body).toEqual({ extension: 'core/todo-finder', autoFix: false });
    req.flush(envelope);
    await expect(promise).resolves.toEqual(envelope);
  });

  it('submitNodeJob() forwards autoFix true on the POST body', async () => {
    const path = 'agents/architect.md';
    const encoded = encodeNodePath(path);
    const envelope = {
      schemaVersion: '1',
      kind: 'job.submitted',
      value: { jobId: 'job-8', nodePath: path, extensionId: 'core/todo-finder', supersededIds: [] },
      elapsedMs: 4,
    };
    const promise = ds.submitNodeJob(path, 'core/todo-finder', true);
    const req = httpMock.expectOne(`/api/nodes/${encoded}/jobs`);
    expect(req.request.body).toEqual({ extension: 'core/todo-finder', autoFix: true });
    req.flush(envelope);
    await expect(promise).resolves.toEqual(envelope);
  });

  it('submitNodeJob() surfaces the 409 envelope code (duplicate-job) via DataSourceError', async () => {
    const encoded = encodeNodePath('agents/architect.md');
    const promise = ds.submitNodeJob('agents/architect.md', 'core/todo-finder');
    const req = httpMock.expectOne(`/api/nodes/${encoded}/jobs`);
    req.flush(
      {
        ok: false,
        error: {
          code: 'duplicate-job',
          message: 'identical job active',
          details: { existingId: 'job-3' },
        },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await expect(promise).rejects.toMatchObject({
      name: 'DataSourceError',
      code: 'duplicate-job',
      details: { existingId: 'job-3' },
    });
  });

  it('cancelJob() POSTs the cancel sub-route and resolves on 204 No Content', async () => {
    const promise = ds.cancelJob('job-7');
    const req = httpMock.expectOne('/api/jobs/job-7/cancel');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await expect(promise).resolves.toBeUndefined();
  });

  it('cancelJob() surfaces the 409 envelope code (job-terminal) via DataSourceError', async () => {
    const promise = ds.cancelJob('job-7');
    const req = httpMock.expectOne('/api/jobs/job-7/cancel');
    req.flush(
      { ok: false, error: { code: 'job-terminal', message: 'job already terminal' } },
      { status: 409, statusText: 'Conflict' },
    );
    await expect(promise).rejects.toMatchObject({
      name: 'DataSourceError',
      code: 'job-terminal',
    });
  });

  it('listJobs() GETs /api/jobs with no query string and returns the envelope items', async () => {
    const items = [
      { id: 'j1', extensionId: 'core/x', status: 'queued', nodeId: 'a.md', createdAt: 1 },
      { id: 'j2', extensionId: 'core/y', status: 'running', nodeId: 'b.md', createdAt: 2 },
    ];
    const promise = ds.listJobs();
    const req = httpMock.expectOne('/api/jobs');
    expect(req.request.method).toBe('GET');
    req.flush({
      schemaVersion: '1',
      kind: 'jobs',
      items,
      filters: { status: null, extension: null, node: null },
      counts: { total: 2, returned: 2 },
    });
    await expect(promise).resolves.toEqual(items);
  });

  it('listJobs(query) encodes status / extension / node filters into the query string', async () => {
    const promise = ds.listJobs({ status: 'queued', extension: 'core/x', node: 'docs/a.md' });
    const req = httpMock.expectOne('/api/jobs?status=queued&extension=core%2Fx&node=docs%2Fa.md');
    expect(req.request.method).toBe('GET');
    req.flush({
      schemaVersion: '1',
      kind: 'jobs',
      items: [],
      filters: { status: 'queued', extension: 'core/x', node: 'docs/a.md' },
      counts: { total: 0, returned: 0 },
    });
    await expect(promise).resolves.toEqual([]);
  });

  it('listJobs() surfaces a 5xx error envelope via DataSourceError', async () => {
    const promise = ds.listJobs();
    const req = httpMock.expectOne('/api/jobs');
    req.flush(
      { ok: false, error: { code: 'internal', message: 'boom' } },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await expect(promise).rejects.toMatchObject({ name: 'DataSourceError', code: 'internal' });
  });

  it('listLinks() builds the kind/from/to query string', async () => {
    const promise = ds.listLinks({ kind: ['invokes'], from: 'a.md', to: 'b.md' });
    const req = httpMock.expectOne('/api/links?kind=invokes&from=a.md&to=b.md');
    req.flush({
      schemaVersion: '1',
      kind: 'links',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
    });
    await promise;
  });

  it('listIssues() forwards severity / analyzerId / node filters', async () => {
    const promise = ds.listIssues({
      severity: 'error',
      analyzerId: 'broken-ref',
      node: 'a.md',
    });
    const req = httpMock.expectOne(
      '/api/issues?severity=error&analyzerId=broken-ref&node=a.md',
    );
    req.flush({
      schemaVersion: '1',
      kind: 'issues',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
    });
    await promise;
  });

  it('loadGraph() requests text/plain ASCII by default', async () => {
    const promise = ds.loadGraph();
    const req = httpMock.expectOne('/api/graph?format=ascii');
    expect(req.request.responseType).toBe('text');
    req.flush('graph contents');
    await expect(promise).resolves.toBe('graph contents');
  });

  it('loadConfig() unwraps the value envelope', async () => {
    const promise = ds.loadConfig();
    const req = httpMock.expectOne('/api/config');
    req.flush({
      schemaVersion: '1',
      kind: 'config',
      value: { tokenizer: 'cl100k_base', schemaVersion: 1 },
    });
    await expect(promise).resolves.toEqual({
      tokenizer: 'cl100k_base',
      schemaVersion: 1,
    });
  });

  it('listPlugins() returns the envelope verbatim', async () => {
    const promise = ds.listPlugins();
    const req = httpMock.expectOne('/api/plugins');
    req.flush({
      schemaVersion: '1',
      kind: 'plugins',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
    });
    await promise;
  });

  it('events() forwards frames from the injected WsEventStreamService', () => {
    const received: IWsEvent[] = [];
    ds.events().subscribe((e) => received.push(e));
    wsSubject.next({
      type: 'scan.completed',
      timestamp: 100,
      runId: 'r-x',
      jobId: null,
      data: { nodes: 1, links: 0, issues: 0, durationMs: 7 },
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('scan.completed');
  });

  it('translates 5xx with error envelope into DataSourceError carrying the code', async () => {
    const promise = ds.health();
    const req = httpMock.expectOne('/api/health');
    req.flush(
      { ok: false, error: { code: 'internal', message: 'boom' } },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await expect(promise).rejects.toMatchObject({
      name: 'DataSourceError',
      code: 'internal',
      message: 'boom',
    });
  });

  it('falls back to internal error when the body is not an error envelope', async () => {
    const promise = ds.health();
    const req = httpMock.expectOne('/api/health');
    req.flush('not json', { status: 502, statusText: 'Bad Gateway' });
    await expect(promise).rejects.toBeInstanceOf(DataSourceError);
  });
});

describe('rest-data-source helpers (__testHooks)', () => {
  it('parseErrorEnvelope rejects shapes that do not match', () => {
    expect(__testHooks.parseErrorEnvelope(null)).toBeNull();
    expect(__testHooks.parseErrorEnvelope({ ok: true })).toBeNull();
    expect(__testHooks.parseErrorEnvelope({ ok: false, error: 'oops' })).toBeNull();
    expect(
      __testHooks.parseErrorEnvelope({ ok: false, error: { code: 'x' } }),
    ).toBeNull();
  });

  it('parseErrorEnvelope accepts the full shape and preserves details', () => {
    const env = __testHooks.parseErrorEnvelope({
      ok: false,
      error: { code: 'bad-query', message: 'missing field', details: { field: 'kind' } },
    });
    expect(env).toEqual({
      ok: false,
      error: { code: 'bad-query', message: 'missing field', details: { field: 'kind' } },
    });
  });

  it('buildNodesQueryString omits empty arrays / undefined values', () => {
    expect(__testHooks.buildNodesQueryString({})).toBe('');
    expect(__testHooks.buildNodesQueryString({ kind: [] })).toBe('');
    expect(__testHooks.buildNodesQueryString({ hasIssues: false })).toBe('?hasIssues=false');
  });
});
