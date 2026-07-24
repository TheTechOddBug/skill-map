import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { QuickStartModal } from '../quick-start-modal';
import { QUICK_START_TEXTS, type TQuickStartStatus } from '../../../../i18n/quick-start.texts';
import { WsEventStreamService } from '../../../../services/ws-event-stream';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import type {
  IActivityCaptureStatusApi,
  IProjectPreferencesApi,
} from '../../../../models/api';

/**
 * QuickStartModal, the Quick Start panel. The PrimeNG dialog renders in a
 * body portal jsdom can't easily inspect, so (like the SettingsModal spec)
 * these assertions target the component's imperative surface, the per-row
 * status / statusText computeds and the mutation handlers, rather than DOM
 * queries. Focused coverage:
 *   - opening the modal probes the project preferences + capture gate;
 *   - a couple of representative rows reflect their probed state in the
 *     status indicator computeds;
 *   - a preference-backed toggle PATCHes the right shape, and a runtime-
 *     owner toggle flips its feature owner.
 */

function prefs(overrides: Partial<IProjectPreferencesApi> = {}): IProjectPreferencesApi {
  return {
    allowSidecarWriters: true,
    scan: {
      referencePaths: [],
      followExternalSymlinks: false,
      respectGitignore: false,
    },
    mcpServerEnabled: false,
    ...overrides,
  };
}

interface ISetupProbe {
  followStatus(): TQuickStartStatus;
  followStatusText(): string;
  captureRowStatus(): TQuickStartStatus;
  captureStatusText(): string;
  liveUpdatesStatus(): TQuickStartStatus;
  mcpInstalledStatus(): TQuickStartStatus;
  mcpInstalledStatusText(): string;
  onCheckMcpConnection(): Promise<void>;
  onFollowSymlinksToggle(): void;
  onLiveUpdatesToggle(): void;
}

interface ISetup {
  cmp: QuickStartModal;
  probe: ISetupProbe;
  fixture: ReturnType<typeof TestBed.createComponent<QuickStartModal>>;
  ws: WsEventStreamService;
}

function bootstrap(stub: Partial<IDataSourcePort>): ISetup {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
      // The row services (WsEventStream / NodeActivity / ActivityReadiness)
      // inject the live channel; demo mode keeps them socket-free.
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
    ],
  });
  const ws = TestBed.inject(WsEventStreamService);
  const fixture = TestBed.createComponent(QuickStartModal);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  return {
    cmp: fixture.componentInstance,
    probe: fixture.componentInstance as unknown as ISetupProbe,
    fixture,
    ws,
  };
}

function open(setup: ISetup): void {
  setup.fixture.componentRef.setInput('visible', true);
  setup.fixture.detectChanges();
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('QuickStartModal, probes on open', () => {
  it('fetches the project preferences and the capture gate when it opens', async () => {
    const getProjectPreferences = vi.fn().mockResolvedValue(prefs());
    const getActivityCapture = vi.fn().mockResolvedValue({ enabled: false });
    const setup = bootstrap({
      getProjectPreferences,
      getActivityCapture,
    } as Partial<IDataSourcePort>);

    open(setup);
    await flushAsync();

    expect(getProjectPreferences).toHaveBeenCalled();
    expect(getActivityCapture).toHaveBeenCalled();
  });
});

describe('QuickStartModal, row status indicators', () => {
  it('marks follow-symlinks ready + "On" when the preference is enabled', async () => {
    const getProjectPreferences = vi
      .fn()
      .mockResolvedValue(prefs({ scan: { referencePaths: [], followExternalSymlinks: true, respectGitignore: false } }));
    const getActivityCapture = vi.fn().mockResolvedValue({ enabled: false });
    const setup = bootstrap({
      getProjectPreferences,
      getActivityCapture,
    } as Partial<IDataSourcePort>);

    open(setup);
    await flushAsync();

    expect(setup.probe.followStatus()).toBe('ready');
    expect(setup.probe.followStatusText()).toBe(QUICK_START_TEXTS.status.on);
  });

  it('marks capture not-ready + "Off" when the gate is disabled', async () => {
    const getProjectPreferences = vi.fn().mockResolvedValue(prefs());
    const captureStatus: IActivityCaptureStatusApi = { enabled: false };
    const getActivityCapture = vi.fn().mockResolvedValue(captureStatus);
    const setup = bootstrap({
      getProjectPreferences,
      getActivityCapture,
    } as Partial<IDataSourcePort>);

    open(setup);
    await flushAsync();

    expect(setup.probe.captureRowStatus()).toBe('not-ready');
    expect(setup.probe.captureStatusText()).toBe(QUICK_START_TEXTS.status.off);
  });

  it('reads Live updates from the ws runtime owner (default ON)', () => {
    const setup = bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefs()),
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
    } as Partial<IDataSourcePort>);

    // The WsEventStreamService default is enabled, so the row is ready
    // before any probe (it binds the live signal, not a fetch).
    expect(setup.probe.liveUpdatesStatus()).toBe('ready');
  });
});

describe('QuickStartModal, MCP connection check', () => {
  it('marks the row ready + "Connected" when a client is connected', async () => {
    const mcpStatus = vi
      .fn()
      .mockResolvedValue({ enabled: true, connected: true, clients: 1 });
    const setup = bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefs()),
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
      mcpStatus,
    } as Partial<IDataSourcePort>);

    // Not checked yet before the user clicks Check.
    expect(setup.probe.mcpInstalledStatus()).toBe('unknown');
    expect(setup.probe.mcpInstalledStatusText()).toBe(QUICK_START_TEXTS.status.notChecked);

    await setup.probe.onCheckMcpConnection();
    await flushAsync();

    expect(mcpStatus).toHaveBeenCalled();
    expect(setup.probe.mcpInstalledStatus()).toBe('ready');
    expect(setup.probe.mcpInstalledStatusText()).toBe(QUICK_START_TEXTS.status.connected);
  });

  it('marks the row not-ready + "Not connected yet" when nothing is connected', async () => {
    const mcpStatus = vi
      .fn()
      .mockResolvedValue({ enabled: true, connected: false, clients: 0 });
    const setup = bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefs()),
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
      mcpStatus,
    } as Partial<IDataSourcePort>);

    await setup.probe.onCheckMcpConnection();
    await flushAsync();

    expect(mcpStatus).toHaveBeenCalled();
    expect(setup.probe.mcpInstalledStatus()).toBe('not-ready');
    expect(setup.probe.mcpInstalledStatusText()).toBe(QUICK_START_TEXTS.status.notConnected);
  });
});

describe('QuickStartModal, mutations', () => {
  it('enabling follow-symlinks PATCHes the project preferences', async () => {
    const getProjectPreferences = vi.fn().mockResolvedValue(prefs());
    const getActivityCapture = vi.fn().mockResolvedValue({ enabled: false });
    const setProjectPreferences = vi
      .fn()
      .mockResolvedValue(prefs({ scan: { referencePaths: [], followExternalSymlinks: true, respectGitignore: false } }));
    const setup = bootstrap({
      getProjectPreferences,
      getActivityCapture,
      setProjectPreferences,
    } as Partial<IDataSourcePort>);

    open(setup);
    await flushAsync();

    setup.probe.onFollowSymlinksToggle();
    await flushAsync();

    expect(setProjectPreferences).toHaveBeenCalledWith({
      scan: { followExternalSymlinks: true },
    });
  });

  it('Live updates toggle flips the WsEventStreamService owner', () => {
    const setup = bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefs()),
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
    } as Partial<IDataSourcePort>);

    const setEnabled = vi.spyOn(setup.ws, 'setEnabled').mockImplementation(() => {});

    // Default owner state is enabled, so the toggle turns it OFF.
    setup.probe.onLiveUpdatesToggle();

    expect(setEnabled).toHaveBeenCalledWith(false);
  });
});
