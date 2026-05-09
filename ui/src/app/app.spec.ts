import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { DATA_SOURCE, type IDataSourcePort } from '../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../services/data-source/runtime-mode';
import { UpdateCheckService } from './services/update-check';
import { EMPTY } from 'rxjs';

const STUB_DATA_SOURCE: IDataSourcePort = {
  health: () =>
    Promise.resolve({
      ok: true,
      schemaVersion: '1',
      specVersion: '0.0.0',
      implVersion: '0.0.0',
      scope: 'project',
      db: 'missing',
    }),
  loadScan: () =>
    Promise.resolve({
      schemaVersion: 1,
      scannedAt: 0,
      scope: 'project',
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
  lookupContribution: () => Promise.resolve(null),
  events: () => EMPTY,
};

/**
 * Wire the standard TestBed providers for the shell, swapping in a
 * real-but-pre-seeded `UpdateCheckService` so tests drive the chip
 * via its writable `status` signal. We never call `load()` in tests —
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
      { provide: UpdateCheckService, useValue: updateStub },
    ],
  }).compileComponents();
}

describe('App', () => {
  beforeEach(async () => {
    // Default stub: no update available — keeps the existing assertions
    // (heading, app construction) passing without touching the chip.
    const stub = new UpdateCheckService();
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

describe('App — update chip', () => {
  it('renders the chip when UpdateCheckService reports an outdated status', async () => {
    TestBed.resetTestingModule();
    const stub = new UpdateCheckService();
    stub.status.set({
      current: '0.18.0',
      latest: '0.19.0',
      isOutdated: true,
      checkedAt: 1700000000000,
      shownAt: null,
    });
    await configure(stub);

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const chip = compiled.querySelector('[data-testid="shell-update-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('aria-label')).toContain('0.19.0');
    expect(chip?.getAttribute('href')).toContain('npmjs.com/package/@skill-map/cli');
  });

  it('omits the chip when no update is available', async () => {
    TestBed.resetTestingModule();
    const stub = new UpdateCheckService();
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
