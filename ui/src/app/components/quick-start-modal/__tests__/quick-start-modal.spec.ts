import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { QuickStartModal } from '../quick-start-modal';
import {
  QUICK_START_TEXTS,
  type IMcpRegisterSnippet,
  type TQuickStartStatus,
} from '../../../../i18n/quick-start.texts';
import { WsEventStreamService } from '../../../../services/ws-event-stream';
import { ActivityReadinessService } from '../../../services/activity-readiness';
import { ProjectInfoService } from '../../../services/project-info';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import type {
  IActivityCaptureStatusApi,
  IHealthResponseApi,
  IMcpStatusApi,
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

/**
 * Endpoint the fake server reports through `/api/mcp/status`. Deliberately
 * NOT the jsdom page origin (`http://localhost:3000`) and not the 4242
 * default, so a payload built from the origin is impossible to confuse with
 * one built from the server's own bind.
 */
const MCP_URL = 'http://127.0.0.1:4999/mcp';

function mcpStatus(overrides: Partial<IMcpStatusApi> = {}): IMcpStatusApi {
  return { enabled: true, connected: false, clients: 0, url: MCP_URL, ...overrides };
}

/** `/api/health` payload with the MCP mount flag under test. */
function health(mcp: boolean): IHealthResponseApi {
  return {
    ok: true,
    schemaVersion: '1',
    specVersion: '0.0.0',
    implVersion: '0.0.0',
    db: 'present',
    cwd: '/proj',
    dbPath: '/proj/.skill-map/skill-map.db',
    mcp,
  };
}

/**
 * Resolve `/api/health` on the shared `ProjectInfoService`: the MCP row's
 * verdict rides its `mcp` signal (the same one row f reads).
 */
async function useMcpLive(expected: boolean): Promise<void> {
  await TestBed.inject(ProjectInfoService).load();
  expect(TestBed.inject(ProjectInfoService).mcp()).toBe(expected);
}

interface ISetupProbe {
  followStatus(): TQuickStartStatus;
  followStatusText(): string;
  captureRowStatus(): TQuickStartStatus;
  captureStatusText(): string;
  captureActionDisabled(): boolean;
  captureActionLabel(): string;
  captureMeta(): string | null;
  /** Row (a) handle from `setupToggleRow` (Live updates). */
  liveRow: { status(): TQuickStartStatus; toggle(): void };
  mcpInstalledStatus(): TQuickStartStatus;
  mcpInstalledStatusText(): string;
  mcpSnippet(): IMcpRegisterSnippet;
  mcpCopyLabel(): string;
  mcpInstalledMeta(): string | null;
  mcpInstalledMetaTone(): 'muted' | 'warn';
  onCheckMcpConnection(): Promise<void>;
  onFollowSymlinksToggle(): void;
  selectGroup(id: 'live' | 'realtime' | 'ai'): void;
  tutorialNotePrefix(): string;
  tutorialInvocation(): string;
}

interface ISetup {
  cmp: QuickStartModal;
  probe: ISetupProbe;
  fixture: ReturnType<typeof TestBed.createComponent<QuickStartModal>>;
  ws: WsEventStreamService;
}

/**
 * `hookInstalled` drives the hook-gated rows (real-time activity, capture)
 * through the shared readiness service; the stub keeps it deterministic.
 * Default `null` = unknown, which is what the real probe resolves to
 * against these stubs and is the fail-open case.
 */
function bootstrap(
  stub: Partial<IDataSourcePort>,
  opts?: { hookInstalled?: boolean | null },
): ISetup {
  TestBed.resetTestingModule();
  // NOT `??`: an explicit `null` (hook state unknown) must survive.
  const hookInstalled = opts?.hookInstalled === undefined ? null : opts.hookInstalled;
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
      // The row services (WsEventStream / NodeActivity / ActivityReadiness)
      // inject the live channel; demo mode keeps them socket-free.
      { provide: SKILL_MAP_MODE, useValue: 'demo' },
      {
        provide: ActivityReadinessService,
        useValue: {
          hookInstalled: signal(hookInstalled).asReadonly(),
          refresh: vi.fn().mockResolvedValue(undefined),
        } as unknown as ActivityReadinessService,
      },
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

/**
 * Land an active lens on the shared `ProjectInfoService` (the modal reads
 * `activeProvider` from it), by resolving its probe against the stub.
 */
async function useLens(providerId: string): Promise<void> {
  await TestBed.inject(ProjectInfoService).reloadActiveProvider();
  expect(TestBed.inject(ProjectInfoService).activeProvider()).toBe(providerId);
}

/** Stub half of `useLens`: the `/api/active-provider` payload for a lens. */
function activeProviderStub(providerId: string): Partial<IDataSourcePort> {
  return {
    getActiveProvider: vi.fn().mockResolvedValue({
      activeProvider: providerId,
      detected: [providerId],
      source: 'config',
      selectable: [providerId],
      markerDrift: null,
    }),
  } as Partial<IDataSourcePort>;
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
    expect(setup.probe.liveRow.status()).toBe('ready');
  });
});

/**
 * Capture is subordinate to the real-time hook: without it no activity
 * event reaches skill-map, so turning the gate on would record nothing.
 * The lock is directional (ENABLE only) and fails open on an unknown
 * hook state, mirroring the sibling real-time row.
 */
describe('QuickStartModal, capture gated on the real-time hook', () => {
  function captureSetup(
    enabled: boolean,
    hookInstalled: boolean | null,
  ): ISetup {
    return bootstrap(
      {
        getProjectPreferences: vi.fn().mockResolvedValue(prefs()),
        getActivityCapture: vi.fn().mockResolvedValue({ enabled }),
      } as Partial<IDataSourcePort>,
      { hookInstalled },
    );
  }

  it('locks the action and explains why while the hook is missing', async () => {
    const setup = captureSetup(false, false);

    open(setup);
    await flushAsync();

    expect(setup.probe.captureActionDisabled()).toBe(true);
    expect(setup.probe.captureMeta()).toBe(QUICK_START_TEXTS.rows.capture.blockedHint);
  });

  it('reads NOT ready while capturing without the hook (nothing can arrive)', async () => {
    const setup = captureSetup(true, false);

    open(setup);
    await flushAsync();

    // The preference is stored, but no activity event ever reaches the
    // server, so the indicator must not claim readiness. Same fold the
    // realtime row applies.
    expect(setup.probe.captureRowStatus()).toBe('not-ready');
  });

  it('reads ready when capturing WITH the hook installed', async () => {
    const setup = captureSetup(true, true);

    open(setup);
    await flushAsync();

    expect(setup.probe.captureRowStatus()).toBe('ready');
  });

  it('still allows turning an already-capturing gate OFF without the hook', async () => {
    const setup = captureSetup(true, false);

    open(setup);
    await flushAsync();

    // Only ENABLING is gated: a capture left on must always be stoppable.
    expect(setup.probe.captureActionDisabled()).toBe(false);
    expect(setup.probe.captureActionLabel()).toBe(QUICK_START_TEXTS.action.disable);
  });

  it('leaves the action free once the hook is installed', async () => {
    const setup = captureSetup(false, true);

    open(setup);
    await flushAsync();

    expect(setup.probe.captureActionDisabled()).toBe(false);
    expect(setup.probe.captureMeta()).toBeNull();
  });

  it('fails OPEN while the hook state is unknown', async () => {
    const setup = captureSetup(false, null);

    open(setup);
    await flushAsync();

    // A probe hiccup never locks the gate.
    expect(setup.probe.captureActionDisabled()).toBe(false);
    expect(setup.probe.captureMeta()).toBeNull();
  });
});

describe('QuickStartModal, MCP connection check', () => {
  it('marks the row ready + "Connected" when a client is connected', async () => {
    const probeMcp = vi.fn().mockResolvedValue(mcpStatus({ connected: true, clients: 1 }));
    const setup = bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefs()),
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
      mcpStatus: probeMcp,
    } as Partial<IDataSourcePort>);

    // Not checked yet before the user clicks Check.
    expect(setup.probe.mcpInstalledStatus()).toBe('unknown');
    expect(setup.probe.mcpInstalledStatusText()).toBe(QUICK_START_TEXTS.status.unknown);

    await setup.probe.onCheckMcpConnection();
    await flushAsync();

    expect(probeMcp).toHaveBeenCalled();
    expect(setup.probe.mcpInstalledStatus()).toBe('ready');
    expect(setup.probe.mcpInstalledStatusText()).toBe(QUICK_START_TEXTS.status.connected);
  });

  it('marks the row not-ready + "Not connected yet" when nothing is connected', async () => {
    const probeMcp = vi.fn().mockResolvedValue(mcpStatus());
    const setup = bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefs()),
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
      mcpStatus: probeMcp,
      // A command lens, so no paste hint competes for the meta line.
      ...activeProviderStub('claude'),
    } as Partial<IDataSourcePort>);

    await setup.probe.onCheckMcpConnection();
    await flushAsync();

    expect(probeMcp).toHaveBeenCalled();
    expect(setup.probe.mcpInstalledStatus()).toBe('not-ready');
    expect(setup.probe.mcpInstalledStatusText()).toBe(QUICK_START_TEXTS.status.notConnected);
    // No session is not necessarily a broken setup, so the row explains
    // itself instead of leaving the operator to read it as a failure.
    expect(setup.probe.mcpInstalledMeta()).toBe(
      QUICK_START_TEXTS.rows.mcpInstalled.unconnectedHint,
    );
    expect(setup.probe.mcpInstalledMetaTone()).toBe('muted');
  });

  it('probes the endpoint when the modal opens, without landing a verdict', async () => {
    const probeMcp = vi.fn().mockResolvedValue(mcpStatus({ connected: true, clients: 1 }));
    const setup = bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefs()),
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
      mcpStatus: probeMcp,
      ...activeProviderStub('claude'),
    } as Partial<IDataSourcePort>);

    open(setup);
    await useLens('claude');
    await flushAsync();

    expect(probeMcp).toHaveBeenCalled();
    expect(setup.probe.mcpSnippet().payload).toContain(MCP_URL);
    // The open probe reads the URL only: the connection verdict stays the
    // user's to ask for through Check.
    expect(setup.probe.mcpInstalledStatus()).toBe('unknown');
    expect(setup.probe.mcpInstalledStatusText()).toBe(QUICK_START_TEXTS.status.unknown);
  });

  it('does not borrow the MCP-server health signal that row (f) already owns', async () => {
    const setup = bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefs()),
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
      health: vi.fn().mockResolvedValue(health(true)),
      mcpStatus: vi.fn().mockResolvedValue(mcpStatus()),
      ...activeProviderStub('claude'),
    } as Partial<IDataSourcePort>);

    // The server is live, which is a DIFFERENT fact reported one row up:
    // this row stays unchecked until the operator confirms the wire.
    await useMcpLive(true);

    expect(setup.probe.mcpInstalledStatus()).toBe('unknown');
    expect(setup.probe.mcpInstalledStatusText()).toBe(QUICK_START_TEXTS.status.unknown);
  });
});

describe('QuickStartModal, MCP register snippet', () => {
  function bootstrapLens(providerId: string): ISetup {
    return bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefs()),
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
      mcpStatus: vi.fn().mockResolvedValue(mcpStatus()),
      ...activeProviderStub(providerId),
    } as Partial<IDataSourcePort>);
  }

  it('builds the claude command from the server URL, never the page origin', async () => {
    const setup = bootstrapLens('claude');

    open(setup);
    await useLens('claude');
    await flushAsync();

    const snippet = setup.probe.mcpSnippet();
    expect(snippet.kind).toBe('command');
    expect(snippet.payload).toBe(
      `claude mcp add --transport http --scope local skill-map ${MCP_URL}`,
    );
    expect(snippet.payload).not.toContain(document.location.origin);
    expect(setup.probe.mcpCopyLabel()).toBe(QUICK_START_TEXTS.action.copyCommand);
  });

  it('builds the codex command with --url from the server URL', async () => {
    const setup = bootstrapLens('codex');

    open(setup);
    await useLens('codex');
    await flushAsync();

    const snippet = setup.probe.mcpSnippet();
    expect(snippet.kind).toBe('command');
    expect(snippet.payload).toBe(`codex mcp add skill-map --url ${MCP_URL}`);
    expect(snippet.payload).not.toContain(document.location.origin);
  });

  it('gives antigravity a full serverUrl document aimed at the home-global file', async () => {
    const setup = bootstrapLens('antigravity');

    open(setup);
    await useLens('antigravity');
    await flushAsync();

    const snippet = setup.probe.mcpSnippet();
    expect(snippet.kind).toBe('config');
    // The operator's PERSONAL config, so the registration never lands in a
    // file the repository shares.
    expect(snippet.target).toBe('~/.gemini/config/mcp_config.json');
    expect(snippet.payload).toContain('"serverUrl"');
    expect(snippet.payload).toContain(MCP_URL);
    // Pretty-printed, so the operator can paste it as-is.
    expect(snippet.payload).toContain('\n');
    // A COMPLETE document: that file usually does not exist yet, so the
    // payload has to be saveable as-is (the paste hint covers the merge
    // case for an operator who already has one).
    expect(JSON.parse(snippet.payload)).toEqual({
      mcpServers: { 'skill-map': { serverUrl: MCP_URL } },
    });
    // A config lens flips the Copy affordance and surfaces the target file.
    expect(setup.probe.mcpCopyLabel()).toBe(QUICK_START_TEXTS.action.copyConfig);
    expect(setup.probe.mcpInstalledMeta()).toBe(
      QUICK_START_TEXTS.rows.mcpInstalled.pasteHint('~/.gemini/config/mcp_config.json'),
    );
    // Pending manual work, so it wears the warning hue (user call
    // 2026-07-25), unlike the muted copy acknowledgement.
    expect(setup.probe.mcpInstalledMetaTone()).toBe('warn');
  });

  it('gives opencode a full remote-type document for its personal global config', async () => {
    const setup = bootstrapLens('opencode');

    open(setup);
    await useLens('opencode');
    await flushAsync();

    const snippet = setup.probe.mcpSnippet();
    expect(snippet.kind).toBe('config');
    // The GLOBAL config, not the project `opencode.json`: OpenCode's docs
    // call that one safe to commit, so it is the team's file and a
    // per-developer tool has no business writing itself into it.
    expect(snippet.target).toBe('~/.config/opencode/opencode.json');
    expect(snippet.payload).toContain('"type": "remote"');
    expect(JSON.parse(snippet.payload)).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: { 'skill-map': { type: 'remote', url: MCP_URL, enabled: true } },
    });
    expect(setup.probe.mcpCopyLabel()).toBe(QUICK_START_TEXTS.action.copyConfig);
  });

  it('falls back to the bare endpoint (no --mcp flag talk) on an unknown lens', async () => {
    const setup = bootstrapLens('markdown');

    open(setup);
    await useLens('markdown');
    await flushAsync();

    const snippet = setup.probe.mcpSnippet();
    expect(snippet.kind).toBe('config');
    expect(snippet.target).toBeUndefined();
    expect(snippet.payload).toBe(MCP_URL);
    // No target to name, so the hint line stays empty.
    expect(setup.probe.mcpInstalledMeta()).toBeNull();
  });

  it('falls back to the page origin while the endpoint probe has not resolved', () => {
    const setup = bootstrapLens('claude');

    // Nothing opened yet, so no probe has landed: the snippet still has to
    // hand over something dialable.
    expect(setup.probe.mcpSnippet().payload).toContain(`${document.location.origin}/mcp`);
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
    setup.probe.liveRow.toggle();

    expect(setEnabled).toHaveBeenCalledWith(false);
  });
});

/**
 * The per-group tutorial pointer: every panel closes with a note naming
 * the matching part of the `sm-tutorial` book and how to launch it on
 * the active lens (sigil-joined handle, `/` fallback while no lens).
 */
describe('QuickStartModal, tutorial pointer', () => {
  it('names the matching book part per group and the sigil-joined invocation', () => {
    const setup = bootstrap({
      getProjectPreferences: vi.fn().mockResolvedValue(prefs()),
      getActivityCapture: vi.fn().mockResolvedValue({ enabled: false }),
    } as Partial<IDataSourcePort>);

    // No lens resolved: the invocation falls back to the `/` sigil.
    expect(setup.probe.tutorialNotePrefix()).toContain('The live map (prologue)');
    expect(setup.probe.tutorialInvocation()).toBe('/sm-tutorial');

    setup.probe.selectGroup('realtime');
    expect(setup.probe.tutorialNotePrefix()).toContain('Real time: watch your agent run');

    setup.probe.selectGroup('ai');
    expect(setup.probe.tutorialNotePrefix()).toContain('The AI layer: your agent works the map');
  });
});
