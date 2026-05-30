import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { App } from '../app';
import { DATA_SOURCE, type IDataSourcePort } from '../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../services/data-source/runtime-mode';
import { WS_SOCKET_FACTORY, type TWsSocketFactory, type IWsLike } from '../../services/ws-event-stream';
import { UpdateCheckService } from '../services/update-check';
import { EMPTY } from 'rxjs';

/**
 * Inert WebSocket. The App shell test runs in `'live'` mode (so
 * <sm-demo-banner> resolves SKILL_MAP_MODE), which would otherwise make
 * WsEventStreamService open a real socket that fails under the test rig
 * and spams `[ws] socket error` / `[ws] closed` into the console. This
 * fake never invokes its handlers, so the service stays silent.
 * (Production resolves WS_SOCKET_FACTORY to `(url) => new WebSocket(url)`.)
 */
const inertWsSocketFactory: TWsSocketFactory = (): IWsLike => ({
  readyState: 0,
  close: () => undefined,
  onopen: null,
  onclose: null,
  onmessage: null,
  onerror: null,
});

const STUB_DATA_SOURCE: IDataSourcePort = {
  health: () =>
    Promise.resolve({
      ok: true,
      schemaVersion: '1',
      specVersion: '0.0.0',
      implVersion: '0.0.0',
      db: 'missing',
      cwd: '/tmp/test',
      dbPath: '/tmp/test/.skill-map/scan.db',
    }),
  loadScan: () =>
    Promise.resolve({
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
    }),
  listNodes: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'nodes',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  getNode: () => Promise.resolve(null),
  listLinks: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'links',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  listIssues: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'issues',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  loadGraph: () => Promise.resolve(''),
  loadConfig: () => Promise.resolve({}),
  listPlugins: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'plugins',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  setFavorite: () => Promise.resolve(),
  unsetFavorite: () => Promise.resolve(),
  getPreferences: () =>
    Promise.resolve({ updateCheck: { enabled: true }, telemetry: { errorsEnabled: false } }),
  setPreferences: () =>
    Promise.resolve({ updateCheck: { enabled: true }, telemetry: { errorsEnabled: false } }),
  getProjectPreferences: () =>
    Promise.resolve({ scan: { referencePaths: [] } }),
  setProjectPreferences: () =>
    Promise.resolve({ scan: { referencePaths: [] } }),
  getProjectIgnore: () => Promise.resolve({ patterns: [] }),
  setProjectIgnore: () => Promise.resolve({ patterns: [] }),
  getActiveProvider: () =>
    Promise.resolve({ activeProvider: null, detected: [], source: 'none' as const }),
  setActiveProvider: () =>
    Promise.resolve({
      activeProvider: null,
      detected: [],
      source: 'none' as const,
      switch: { dropped: null },
    }),
  setPluginEnabled: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'plugins',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  setPluginExtensionEnabled: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'plugins',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  applyPluginChanges: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'plugins',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0 },
      kindRegistry: {},
    }),
  runScan: () =>
    Promise.resolve({
      schemaVersion: 1,
      scannedAt: 0,
      roots: [],
      nodes: [],
      links: [],
      issues: [],
      enrichments: [],
      contributions: [],
      stats: { totalNodes: 0, totalLinks: 0, totalIssues: 0 },
    } as unknown as Awaited<ReturnType<IDataSourcePort['runScan']>>),
  lookupContribution: () => Promise.resolve(null),
  bumpSidecar: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'sidecar.bumped',
      value: { nodePath: '', version: null, status: 'fresh' },
      elapsedMs: 0,
    }),
  getUpdateStatus: () =>
    Promise.resolve({
      current: '0.0.0',
      latest: null,
      isOutdated: false,
      checkedAt: null,
      shownAt: null,
    }),
  getRegisteredAnnotations: () => Promise.resolve([]),
  events: () => EMPTY,
};

/**
 * Construct an `UpdateCheckService`-shaped stub without going through
 * Angular DI. The service now injects `DATA_SOURCE` via a field
 * initializer, so `new UpdateCheckService()` outside an injection
 * context throws NG0203. Tests don't need the data-source plumbing
 * (they drive `status` directly), so we cast a minimal signal bag to
 * the service type and feed it into the App via the `useValue`
 * provider, the consumer reads `isOutdated()` / `latest()` /
 * `current()` / `status.set()` only.
 */
function makeUpdateCheckStub(): UpdateCheckService {
  const status = signal<{
    current: string;
    latest: string | null;
    isOutdated: boolean;
    checkedAt: number | null;
    shownAt: number | null;
  } | null>(null);
  return {
    status,
    isOutdated: computed(() => status()?.isOutdated === true),
    latest: computed(() => status()?.latest ?? null),
    current: computed(() => status()?.current ?? null),
    load: async () => undefined,
  } as unknown as UpdateCheckService;
}

/**
 * Wire the standard TestBed providers for the shell, swapping in a
 * real-but-pre-seeded `UpdateCheckService` so tests drive the chip
 * via its writable `status` signal. We never call `load()` in tests,
 * the network is not stubbed and the service silences fetch errors,
 * so it would be a no-op anyway. Driving `status` directly keeps the
 * computed `isOutdated` / `latest` derivations exercised end-to-end.
 */
async function configure(updateStub: UpdateCheckService): Promise<void> {
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
      // The shell now mounts <sm-demo-banner>, which reads
      // SKILL_MAP_MODE on construction. Provide a default so the
      // boot test doesn't hit the missing-token path.
      { provide: SKILL_MAP_MODE, useValue: 'live' },
      // Keep the live-mode WS service from opening a real socket (see
      // inertWsSocketFactory): without this it logs connection failures.
      { provide: WS_SOCKET_FACTORY, useValue: inertWsSocketFactory },
      { provide: UpdateCheckService, useValue: updateStub },
    ],
  }).compileComponents();
}

describe('App', () => {
  beforeEach(async () => {
    // Default stub: no update available, keeps the existing assertions
    // (heading, app construction) passing without touching the chip.
    const stub = makeUpdateCheckStub();
    await configure(stub);
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the prototype heading', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('skill-map');
  });
});

describe('App, update chip', () => {
  it('renders the chip when UpdateCheckService reports an outdated status', async () => {
    TestBed.resetTestingModule();
    const stub = makeUpdateCheckStub();
    stub.status.set({
      current: '0.18.0',
      latest: '0.19.0',
      isOutdated: true,
      checkedAt: 1700000000000,
      shownAt: null,
    });
    await configure(stub);

    const fixture = TestBed.createComponent(App);
    // The chip is also gated on `!isDevMode()` so a developer running
    // `npm run ui:dev` doesn't see a noisy "update available" hint. In
    // the test harness `isDevMode()` returns `true`, which would mask
    // the assertion below, override the instance flag to simulate the
    // prod-build path where the chip is allowed to render.
    (fixture.componentInstance as unknown as { isDevMode: boolean }).isDevMode = false;
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const chip = compiled.querySelector('[data-testid="shell-update-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('aria-label')).toContain('0.19.0');
    const npmLink = compiled.querySelector('[data-testid="shell-update-npm-link"]');
    expect(npmLink).not.toBeNull();
    expect(npmLink?.getAttribute('href')).toContain('npmjs.com/package/@skill-map/cli');
  });

  it('omits the chip in dev mode even when an update is available', async () => {
    TestBed.resetTestingModule();
    const stub = makeUpdateCheckStub();
    stub.status.set({
      current: '0.18.0',
      latest: '0.19.0',
      isOutdated: true,
      checkedAt: 1700000000000,
      shownAt: null,
    });
    await configure(stub);

    const fixture = TestBed.createComponent(App);
    // `isDevMode()` is true under the test harness, no override needed.
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="shell-update-chip"]')).toBeNull();
  });

  it('omits the chip when no update is available', async () => {
    TestBed.resetTestingModule();
    const stub = makeUpdateCheckStub();
    stub.status.set({
      current: '0.18.0',
      latest: '0.18.0',
      isOutdated: false,
      checkedAt: 1700000000000,
      shownAt: null,
    });
    await configure(stub);

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="shell-update-chip"]')).toBeNull();
  });
});
