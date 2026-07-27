/**
 * Boot-ordering guard for the live channel: a checkout with
 * `ui.liveUpdates: false` persisted in `settings.local.json` must NOT open
 * the `/ws` socket at startup.
 *
 * The regression this pins: the live-updates preference and the cold-start
 * probes used to live in two SEPARATE `provideAppInitializer` factories.
 * Angular invokes every initializer factory synchronously in registration
 * order and only `Promise.all`s the returned promises, so the cold-start
 * factory (which constructs `CollectionLoaderService`, the first `/ws`
 * subscriber) ran WHILE the awaited `LivePreferencesService.load()` GET was
 * still in flight. The socket therefore flash-opened on the ON default and
 * the late-arriving OFF never closed it: the Settings toggle read OFF while
 * the map kept live-updating on every watcher scan.
 *
 * The fix folds both steps into one awaited initializer,
 * `settleLivePrefsThenColdStart`, which this spec drives directly (the real
 * `appConfig` boot cannot be run in a unit test without dragging in PrimeNG
 * theme imports, Sentry, and PostHog).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Injector } from '@angular/core';

import { settleLivePrefsThenColdStart } from '../app.config';
import { DATA_SOURCE, type IDataSourcePort } from '../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../services/data-source/runtime-mode';
import {
  WsEventStreamService,
  WS_SOCKET_FACTORY,
  type IWsLike,
} from '../../services/ws-event-stream';
import { LivePreferencesService } from '../../services/live-preferences';
import { CollectionLoaderService } from '../../services/collection-loader';
import { UpdateCheckService } from '../services/update-check';
import { ProjectInfoService } from '../services/project-info';

/** A socket that never invokes its handlers, so the service stays silent. */
function makeInertSocket(): IWsLike {
  return {
    readyState: 0,
    close: () => undefined,
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
  };
}

const EMPTY_META = {
  schemaVersion: 1,
  scannedAt: 0,
  roots: ['.'],
  providers: [],
  nodes: [],
  links: [],
  issues: [],
  stats: { filesWalked: 0, filesSkipped: 0, nodesCount: 0, linksCount: 0, issuesCount: 0, durationMs: 0 },
};
const EMPTY_BRANCH = {
  schemaVersion: '1',
  kind: 'branch',
  branch: { paths: [], excluded: [], rootExcluded: false, total: 0, rendered: 0, truncated: false, cap: 256 },
  nodes: [],
  links: [],
  issues: [],
};

describe('app.config boot ordering, ui.liveUpdates persisted OFF', () => {
  let socketFactory: ReturnType<typeof vi.fn>;
  // Resolves the in-flight `GET /api/project-preferences` to `liveUpdates:
  // false`, simulating a persisted OFF whose read is still pending when the
  // cold-start step would otherwise construct the loader.
  let resolvePrefsOff: () => void = () => undefined;

  beforeEach(() => {
    // `MapVisibilityService` (root) rehydrates its selection from
    // localStorage; clear it so the loader starts from the whole-corpus root.
    localStorage.clear();
    TestBed.resetTestingModule();
    socketFactory = vi.fn((): IWsLike => makeInertSocket());
    const prefsGate = new Promise<{ ui: { liveUpdates: boolean } }>((resolve) => {
      resolvePrefsOff = () => resolve({ ui: { liveUpdates: false } });
    });
    const dataSource = {
      getProjectPreferences: () => prefsGate,
      loadScanMeta: () => Promise.resolve(EMPTY_META),
      loadFolders: () => Promise.resolve([]),
      loadBranch: () => Promise.resolve(EMPTY_BRANCH),
    } as unknown as IDataSourcePort;
    TestBed.configureTestingModule({
      providers: [
        { provide: SKILL_MAP_MODE, useValue: 'live' },
        { provide: WS_SOCKET_FACTORY, useValue: socketFactory },
        { provide: DATA_SOURCE, useValue: dataSource },
        // The other two cold-start probes are irrelevant here (neither
        // subscribes to `/ws`); stub them so the test depends only on the
        // loader, the sole boot-time socket subscriber.
        { provide: UpdateCheckService, useValue: { load: () => Promise.resolve() } },
        { provide: ProjectInfoService, useValue: { load: () => Promise.resolve() } },
      ],
    });
  });

  afterEach(() => {
    // Tear down whatever socket the WS service opened so it never leaks.
    TestBed.inject(WsEventStreamService).disconnect();
  });

  it('awaits load() before constructing the loader, so a persisted OFF keeps the socket shut', async () => {
    const injector = TestBed.inject(Injector);
    const boot = settleLivePrefsThenColdStart(injector);
    // The preference GET resolves to OFF; only AFTER that does the sequence
    // construct the loader and its first `/ws` subscription.
    resolvePrefsOff();
    await boot;
    expect(socketFactory).not.toHaveBeenCalled();
    expect(TestBed.inject(WsEventStreamService).connectionState()).toBe('disabled');
  });

  it('rationale: subscribing BEFORE the preference settles flash-opens a socket load() never closes', async () => {
    const prefs = TestBed.inject(LivePreferencesService);
    const loading = prefs.load();
    // Construct the loader while `wsEnabled` is still the ON default: the
    // connect-on-subscribe guard opens the socket.
    TestBed.inject(CollectionLoaderService);
    expect(socketFactory).toHaveBeenCalledTimes(1);
    // The OFF lands late and `load()` only sets the signal, it does not close
    // an already-open socket. That divergence is precisely what awaiting
    // `load()` first (the test above) prevents.
    resolvePrefsOff();
    await loading;
    expect(socketFactory).toHaveBeenCalledTimes(1);
  });
});
