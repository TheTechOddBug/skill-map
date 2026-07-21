import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal, type WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { App } from '../app';
import { ActivityReadinessService } from '../services/activity-readiness';
import { ScanTriggerService } from '../services/scan-trigger';
import { DATA_SOURCE, type IDataSourcePort } from '../../services/data-source/data-source.port';
import { NodeActivityService } from '../../services/node-activity';
import { SKILL_MAP_MODE } from '../../services/data-source/runtime-mode';
import { WsEventStreamService, WS_SOCKET_FACTORY, type TWsSocketFactory, type IWsLike } from '../../services/ws-event-stream';
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
  loadScanMeta: () =>
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
  loadFolders: () => Promise.resolve([]),
  loadBranch: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'branch',
      branch: { paths: [], total: 0, rendered: 0, truncated: false, cap: 256 },
      nodes: [],
      links: [],
      issues: [],
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
  getNodeFindings: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'findings',
      items: [],
      filters: {},
      counts: { total: 0, returned: 0, dismissedExcluded: 0, fixedExcluded: 0 },
      kindRegistry: {},
    }),
  getNodeProbExtensions: () =>
    Promise.resolve({ finders: [], standalone: [] }),
  submitNodeJob: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'job.submitted',
      value: { jobId: 'job-1', nodePath: 'a.md', extensionId: 'x/y', supersededIds: [] },
      elapsedMs: 0,
    }),
  cancelJob: () => Promise.resolve(),
  dismissFinding: () => Promise.resolve(),
  resolveFinding: () => Promise.resolve(),
  undismissFinding: () => Promise.resolve(),
  deleteFinding: () => Promise.resolve(),
  cancelAllJobs: () => Promise.resolve(),
  pruneJobs: () => Promise.resolve(),
  listJobs: () => Promise.resolve([]),
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
  getConfigResolution: () => Promise.resolve([]),
  getNodeSummary: () => Promise.resolve([]),
  deleteNodeSummary: () => Promise.resolve(),
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
    Promise.resolve({
      updateCheck: { enabled: true },
      telemetry: { errorsEnabled: false, usageCliEnabled: false, usageUiEnabled: false, anonymousId: null, environment: 'prod' },
    }),
  setPreferences: () =>
    Promise.resolve({
      updateCheck: { enabled: true },
      telemetry: { errorsEnabled: false, usageCliEnabled: false, usageUiEnabled: false, anonymousId: null, environment: 'prod' },
    }),
  getProjectPreferences: () =>
    Promise.resolve({
      allowSidecarWriters: true,
      scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
    }),
  setProjectPreferences: () =>
    Promise.resolve({
      allowSidecarWriters: true,
      scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
    }),
  getProjectIgnore: () => Promise.resolve({ patterns: [] }),
  setProjectIgnore: () => Promise.resolve({ patterns: [] }),
  getActiveProvider: () =>
    Promise.resolve({
      activeProvider: 'markdown',
      detected: [],
      source: 'default' as const,
      selectable: [],
      markerDrift: null,
    }),
  setActiveProvider: () =>
    Promise.resolve({
      activeProvider: 'markdown',
      detected: [],
      source: 'default' as const,
      selectable: [],
      markerDrift: null,
      switch: { dropped: null },
    }),
  acceptActiveProviderMarkers: () =>
    Promise.resolve({
      activeProvider: 'markdown',
      detected: [],
      source: 'default' as const,
      selectable: [],
      markerDrift: null,
    }),
  getActivityInstallStatus: () => Promise.resolve({
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
  }),
  installActivityHook: () => Promise.resolve({
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
  }),
  uninstallActivityHook: () => Promise.resolve({ ...{
    provider: 'markdown',
    supported: false,
    installed: false,
    configPath: null,
    configWired: false,
    bridgePresent: false,
    events: 0,
  }, removed: false }),
  getAgentSkillInstallStatus: () => Promise.resolve({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
  }),
  installAgentSkill: () => Promise.resolve({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
    outcome: 'installed' as const,
  }),
  uninstallAgentSkill: () => Promise.resolve({
    provider: 'markdown',
    supported: false,
    skillDir: null,
    installed: false,
    stale: false,
    removed: false,
  }),
  getActivitySummary: () => Promise.resolve({ since: 0, nodes: {}, pairs: {}, runNodes: [] }),
  getNodeActivity: () =>
    Promise.resolve({
      stats: { count: 0, lastStartAt: 0, distinctOwners: 0 },
      recent: [],
      spawns: [],
      captureEnabled: false,
      runs: [],
    }),
  getSpawnRecord: () => Promise.resolve(null),
  getActivityCapture: () => Promise.resolve({ enabled: false }),
  setActivityCapture: () => Promise.resolve({ enabled: false }),
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
  setPluginTrusted: () =>
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
  dispatchAction: () =>
    Promise.resolve({
      schemaVersion: '1',
      kind: 'action.applied',
      value: { actionId: 'core/node-bump', nodePath: '' },
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

interface IUpdateStatusStub {
  current: string;
  latest: string | null;
  isOutdated: boolean;
  checkedAt: number | null;
  shownAt: number | null;
}

/**
 * Construct an `UpdateCheckService`-shaped stub without going through
 * Angular DI. The service now injects `DATA_SOURCE` via a field
 * initializer, so `new UpdateCheckService()` outside an injection
 * context throws NG0203. Tests don't need the data-source plumbing,
 * so we cast a minimal signal bag to the service type and feed it into
 * the App via the `useValue` provider. The service's own `status` is
 * read-only (`asReadonly()`), so the writable backing signal is handed
 * back alongside the stub for the tests to drive.
 */
function makeUpdateCheckStub(): {
  service: UpdateCheckService;
  status: WritableSignal<IUpdateStatusStub | null>;
} {
  const status = signal<IUpdateStatusStub | null>(null);
  const service = {
    status,
    isOutdated: computed(() => status()?.isOutdated === true),
    latest: computed(() => status()?.latest ?? null),
    current: computed(() => status()?.current ?? null),
    load: async () => undefined,
  } as unknown as UpdateCheckService;
  return { service, status };
}

/**
 * Wire the standard TestBed providers for the shell, swapping in a
 * real-but-pre-seeded `UpdateCheckService` so tests drive the chip
 * via its writable `status` signal. We never call `load()` in tests,
 * the network is not stubbed and the service silences fetch errors,
 * so it would be a no-op anyway. Driving `status` directly keeps the
 * computed `isOutdated` / `latest` derivations exercised end-to-end.
 */
async function configure(
  updateStub: UpdateCheckService,
  dataSource: IDataSourcePort = STUB_DATA_SOURCE,
): Promise<void> {
  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: DATA_SOURCE, useValue: dataSource },
      // The shell mounts <sm-demo-banner>, which reads SKILL_MAP_MODE on
      // construction; provide it explicitly (the token has no default).
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
    await configure(makeUpdateCheckStub().service);
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
    await configure(stub.service);

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
    await configure(stub.service);

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
    await configure(stub.service);

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="shell-update-chip"]')).toBeNull();
  });
});

describe('App, scan spinner', () => {
  it('marks the refresh button spinning + disabled while a scan is in flight', async () => {
    TestBed.resetTestingModule();
    // Gate the stub's `runScan` on a promise the test resolves, so the
    // real `ScanTriggerService.run()` drives `scanning` through its
    // actual lifecycle (`scanning` is read-only outside the service:
    // set on entry, cleared in the `finally`). The topbar `scanning()`
    // ORs it with the watcher's WS `scanActive`; this proves the
    // `is-spinning` class binding is reactive, the CSS animation hangs
    // off that class.
    let finishScan!: () => void;
    const scanGate = new Promise<void>((resolve) => { finishScan = resolve; });
    await configure(makeUpdateCheckStub().service, {
      ...STUB_DATA_SOURCE,
      runScan: async () => {
        await scanGate;
        return STUB_DATA_SOURCE.runScan();
      },
    });

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="shell-refresh"]',
    )!;
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('is-spinning')).toBe(false);
    expect(btn.disabled).toBe(false);

    const runDone = TestBed.inject(ScanTriggerService).run();
    fixture.detectChanges();
    expect(btn.classList.contains('is-spinning')).toBe(true);
    expect(btn.disabled).toBe(true);

    finishScan();
    await runDone;
    fixture.detectChanges();
    expect(btn.classList.contains('is-spinning')).toBe(false);
    expect(btn.disabled).toBe(false);
  });
});

describe('App, scan error surface', () => {
  it('tints the refresh button and swaps its tooltip strings while scanError is set', async () => {
    TestBed.resetTestingModule();
    // First run() rejects so the service's own catch branch persists
    // the message (`scanError` is read-only outside the service); the
    // second run() succeeds and must clear it on entry. The button must
    // surface the failure (UX: a failed manual scan is never silent).
    let failScan = true;
    await configure(makeUpdateCheckStub().service, {
      ...STUB_DATA_SOURCE,
      runScan: () => failScan
        ? Promise.reject(new Error('boom: db locked'))
        : STUB_DATA_SOURCE.runScan(),
    });

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-testid="shell-refresh"]',
    )!;
    expect(btn.classList.contains('is-error')).toBe(false);
    expect(btn.getAttribute('aria-label')).not.toContain('Scan failed');

    const scanTrigger = TestBed.inject(ScanTriggerService);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await scanTrigger.run();
    fixture.detectChanges();
    expect(btn.classList.contains('is-error')).toBe(true);
    expect(btn.getAttribute('aria-label')).toContain('Scan failed: boom: db locked');

    failScan = false;
    await scanTrigger.run();
    warnSpy.mockRestore();
    fixture.detectChanges();
    expect(btn.classList.contains('is-error')).toBe(false);
    expect(btn.getAttribute('aria-label')).not.toContain('Scan failed');
  });
});

describe('App, Real Time toggle', () => {

  /** Readiness stub: the gate state is driven per-test, no probing. */
  function readinessStub(hookInstalled: boolean | null): ActivityReadinessService {
    return {
      hookInstalled: signal(hookInstalled).asReadonly(),
      refresh: () => Promise.resolve(),
    } as unknown as ActivityReadinessService;
  }

  async function configureWithReadiness(hookInstalled: boolean | null): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DATA_SOURCE, useValue: STUB_DATA_SOURCE },
        { provide: SKILL_MAP_MODE, useValue: 'live' },
        { provide: WS_SOCKET_FACTORY, useValue: inertWsSocketFactory },
        { provide: UpdateCheckService, useValue: makeUpdateCheckStub().service },
        { provide: ActivityReadinessService, useValue: readinessStub(hookInstalled) },
      ],
    }).compileComponents();
  }

  function toggleButton(root: HTMLElement): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>(
      '[data-testid="shell-live-activity-toggle"] button',
    )!;
  }

  it('renders first in the actions cluster and toggles the shared activity preference', async () => {
    await configureWithReadiness(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const actions = root.querySelector('.shell__actions')!;
    // FIRST control in the cluster: the wrapper span hosts the button.
    expect(
      actions.firstElementChild?.getAttribute('data-testid'),
    ).toBe('shell-live-activity-tooltip-wrap');

    const btn = toggleButton(root);
    expect(btn.disabled).toBe(false);

    const activity = TestBed.inject(NodeActivityService);
    const persistSpy = vi.spyOn(STUB_DATA_SOURCE, 'setProjectPreferences');
    expect(activity.enabled()).toBe(true);
    btn.click();
    fixture.detectChanges();
    expect(activity.enabled()).toBe(false);
    // The preference persisted through the SAME owner Settings uses,
    // now a project-preferences PATCH (settings.local.json) instead of
    // the retired localStorage key.
    expect(persistSpy).toHaveBeenCalledWith({ ui: { realtimeActivity: false } });
    btn.click();
    fixture.detectChanges();
    expect(activity.enabled()).toBe(true);
    persistSpy.mockRestore();
  });

  it('disables when live updates are off (WS gate)', async () => {
    await configureWithReadiness(true);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    TestBed.inject(WsEventStreamService).setEnabled(false);
    fixture.detectChanges();
    expect(toggleButton(fixture.nativeElement as HTMLElement).disabled).toBe(true);
  });

  it('disables when the hook is known-missing, and FAILS OPEN on unknown', async () => {
    await configureWithReadiness(false);
    const missing = TestBed.createComponent(App);
    await missing.whenStable();
    missing.detectChanges();
    expect(toggleButton(missing.nativeElement as HTMLElement).disabled).toBe(true);

    await configureWithReadiness(null);
    const unknown = TestBed.createComponent(App);
    await unknown.whenStable();
    unknown.detectChanges();
    expect(toggleButton(unknown.nativeElement as HTMLElement).disabled).toBe(false);
  });
});

describe('App, beta chip', () => {
  it('shows the beta chip', async () => {
    TestBed.resetTestingModule();
    await configure(makeUpdateCheckStub().service);

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const chip = (fixture.nativeElement as HTMLElement).querySelector('.shell__beta');
    expect(chip?.textContent?.trim()).toBe('BETA');
  });
});
