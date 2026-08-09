import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { Subject } from 'rxjs';

import { ProcessingAgentReadinessService } from '../processing-agent-readiness';
import { ProjectInfoService } from '../project-info';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import { WsEventStreamService } from '../../../services/ws-event-stream';
import type { IWsScanCompletedEvent } from '../../../models/ws-event';

/**
 * `ProcessingAgentReadinessService`, the shared processing-skill probe
 * that gates every affordance which would submit an AI job (the
 * inspector header's summarize button, the tag row's auto-tag button,
 * the AI Actions launchers / fix buttons). Covers: boot probe, the
 * unsupported lens, fail-open on error and while no lens is resolved,
 * the `scan.completed` re-probe, the lens-change re-probe, and
 * concurrent-refresh coalescing; then the agent-silent half (a failed
 * manual check closes the gate, a green check / observed claim heals
 * it), and the check hold that latches a closed gate while a manual
 * check runs. The MCP session count plays NO part in the gate (user
 * decision 2026-07-28): a CLI-draining agent holds no session.
 */

interface IHarness {
  service: ProcessingAgentReadinessService;
  scanCompleted$: Subject<IWsScanCompletedEvent>;
  jobEvents$: Subject<{ type: string; jobId?: string }>;
  activeProvider: WritableSignal<string | null>;
  getAgentSkillInstallStatus: ReturnType<typeof vi.fn>;
}

function status(
  supported: boolean,
  installed: boolean,
  provider = 'claude',
  stale = false,
): Record<string, unknown> {
  return {
    provider,
    supported,
    skillDir: supported ? '.claude/skills/sm-process-jobs' : null,
    installed,
    stale,
  };
}

function bootstrap(
  stub: Partial<IDataSourcePort>,
  lens: string | null = 'claude',
): IHarness {
  TestBed.resetTestingModule();
  const scanCompleted$ = new Subject<IWsScanCompletedEvent>();
  const jobEvents$ = new Subject<{ type: string; jobId?: string }>();
  const ws = { scanCompleted$, jobEvents$ } as unknown as WsEventStreamService;
  const activeProvider = signal<string | null>(lens);
  TestBed.configureTestingModule({
    providers: [
      { provide: DATA_SOURCE, useValue: stub },
      { provide: WsEventStreamService, useValue: ws },
      { provide: ProjectInfoService, useValue: { activeProvider } as unknown as ProjectInfoService },
    ],
  });
  return {
    service: TestBed.inject(ProcessingAgentReadinessService),
    scanCompleted$,
    jobEvents$,
    activeProvider,
    getAgentSkillInstallStatus: stub.getAgentSkillInstallStatus as ReturnType<typeof vi.fn>,
  };
}

async function settled(): Promise<void> {
  // Microtask hops covering the single awaited read inside `probe()`.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('ProcessingAgentReadinessService', () => {
  it('probes on boot: supported but NOT installed closes the gate (true)', async () => {
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, false)),
    });
    expect(service.skillMissing()).toBe(null); // pending
    // Fail-closed at boot (2026-08-09): no confirmed reading yet, so the
    // surface holds disabled until the probe lands.
    expect(service.submitGateReason()).toBe('probe-pending');
    await settled();
    expect(service.skillMissing()).toBe(true);
  });

  it('installed opens the gate (false); a lens with no skill territory also opens it', async () => {
    const installed = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
    });
    await settled();
    expect(installed.service.skillMissing()).toBe(false);

    const unsupported = bootstrap(
      {
        // `installed: false` on an unsupported lens is the real shape:
        // there is nothing to install, so the gate must NOT close.
        getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(false, false, 'markdown')),
      },
      'markdown',
    );
    await settled();
    expect(unsupported.service.skillMissing()).toBe(false);
  });

  it('an errored probe keeps the gate closed (probe-pending), not open', async () => {
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockRejectedValue(new Error('down')),
    });
    await settled();
    expect(service.skillMissing()).toBe(null);
    // Fail-closed (2026-08-09, superseding the fail-open call): an
    // unconfirmed setup never enables the AI surface on its own.
    expect(service.submitGateReason()).toBe('probe-pending');
    expect(service.submitGateClosed()).toBe(true);
  });

  it('a green check verdict opens the gate even while the skill probe never resolved', async () => {
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockRejectedValue(new Error('down')),
    });
    await settled();
    expect(service.submitGateReason()).toBe('probe-pending');
    // Drainage evidence outranks the pending probe: an answered ping
    // proves the whole pipeline end to end.
    service.noteAgentAlive(true);
    expect(service.submitGateClosed()).toBe(false);
  });

  it('holds closed (probe-pending) and never probes while no lens is resolved', async () => {
    const getAgentSkillInstallStatus = vi.fn().mockResolvedValue(status(true, false));
    const { service } = bootstrap({ getAgentSkillInstallStatus }, null);
    await settled();
    expect(service.skillMissing()).toBe(null);
    expect(service.submitGateReason()).toBe('probe-pending');
    expect(getAgentSkillInstallStatus).not.toHaveBeenCalled();
  });

  it('re-probes on scan.completed and adopts the new state', async () => {
    const getAgentSkillInstallStatus = vi.fn().mockResolvedValue(status(true, false));
    const harness = bootstrap({ getAgentSkillInstallStatus });
    await settled();
    expect(harness.service.skillMissing()).toBe(true);

    // An `sm agent install` ran in a terminal; the next scan tick must
    // surface it and re-open the gate.
    getAgentSkillInstallStatus.mockResolvedValue(status(true, true));
    harness.scanCompleted$.next({
      type: 'scan.completed',
      timestamp: 1,
      data: {},
    } as IWsScanCompletedEvent);
    await settled();
    expect(harness.service.skillMissing()).toBe(false);
  });

  it('re-probes when the active lens changes (the skill is installed per lens)', async () => {
    const getAgentSkillInstallStatus = vi
      .fn()
      .mockImplementation((provider: string) =>
        Promise.resolve(status(true, provider === 'claude', provider)),
      );
    const harness = bootstrap({ getAgentSkillInstallStatus });
    await settled();
    expect(harness.service.skillMissing()).toBe(false); // claude: installed

    harness.activeProvider.set('gemini');
    TestBed.tick(); // flush the lens effect
    await settled();
    expect(getAgentSkillInstallStatus).toHaveBeenLastCalledWith('gemini');
    expect(harness.service.skillMissing()).toBe(true); // gemini: missing
  });

  it('coalesces concurrent refreshes onto one in-flight probe', async () => {
    const getAgentSkillInstallStatus = vi.fn().mockResolvedValue(status(true, true));
    const { service } = bootstrap({ getAgentSkillInstallStatus });
    // The constructor already fired one probe; these two must join it.
    const a = service.refresh();
    const b = service.refresh();
    expect(a).toBe(b);
    await settled();
    expect(getAgentSkillInstallStatus).toHaveBeenCalledTimes(1);

    // A refresh AFTER settlement starts a fresh probe.
    await service.refresh();
    expect(getAgentSkillInstallStatus).toHaveBeenCalledTimes(2);
  });
});

describe('ProcessingAgentReadinessService, the agent-silent half', () => {
  it('a failed manual check closes the gate; a green one reopens it', async () => {
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
    } as Partial<IDataSourcePort>);
    await settled();
    // No check ever ran: fails OPEN, nothing depends on pinging.
    expect(service.submitGateClosed()).toBe(false);

    service.noteAgentAlive(false);
    expect(service.submitGateReason()).toBe('agent-silent');
    expect(service.submitGateClosed()).toBe(true);

    service.noteAgentAlive(true);
    expect(service.submitGateClosed()).toBe(false);
  });

  it('the deeper skill half outranks agent-silent when both are closed', async () => {
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, false)),
    } as Partial<IDataSourcePort>);
    await settled();
    service.noteAgentAlive(false);
    expect(service.submitGateReason()).toBe('skill-missing');
  });

  it('any observed answer (job.completed) heals a failed check live', async () => {
    const { service, jobEvents$ } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
    } as Partial<IDataSourcePort>);
    await settled();
    service.noteAgentAlive(false);
    expect(service.submitGateClosed()).toBe(true);

    jobEvents$.next({ type: 'job.completed', jobId: 'd-x' });
    expect(service.submitGateClosed()).toBe(false);
    expect(service.agentAlive()).toBe(true);
  });
});

/**
 * The check hold (user spec 2026-07-27): a manual check started against
 * a CLOSED gate latches it closed for the whole check window, so the
 * probes riding along with the check can never enable the AI
 * affordances before the verdict itself does.
 */
describe('ProcessingAgentReadinessService, the check hold', () => {
  it('latches a closed gate closed while the check runs, then releases on settle', async () => {
    const getAgentSkillInstallStatus = vi.fn().mockResolvedValue(status(true, false));
    const { service } = bootstrap({
      getAgentSkillInstallStatus,
    } as Partial<IDataSourcePort>);
    await settled();
    expect(service.submitGateReason()).toBe('skill-missing');

    service.noteCheckStarted();
    // The skill lands mid-check (an install finished in a terminal): the
    // live reading flips open, but the gate must hold the starting
    // reason until the verdict lands.
    getAgentSkillInstallStatus.mockResolvedValue(status(true, true));
    await service.refresh();
    expect(service.skillMissing()).toBe(false);
    expect(service.submitGateReason()).toBe('skill-missing');
    expect(service.submitGateClosed()).toBe(true);

    service.noteCheckSettled();
    expect(service.submitGateClosed()).toBe(false);
  });

  it('the claim heal also waits out the hold', async () => {
    const { service, jobEvents$ } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
    } as Partial<IDataSourcePort>);
    await settled();
    service.noteAgentAlive(false);
    expect(service.submitGateReason()).toBe('agent-silent');

    service.noteCheckStarted();
    jobEvents$.next({ type: 'job.completed', jobId: 'd-x' });
    // Healed underneath, but the gate stays latched until the check
    // settles (in real flow that follows the claim within microtasks).
    expect(service.agentAlive()).toBe(true);
    expect(service.submitGateClosed()).toBe(true);

    service.noteCheckSettled();
    expect(service.submitGateClosed()).toBe(false);
  });

  it('never freezes an OPEN gate open: a mid-check close still lands', async () => {
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
    } as Partial<IDataSourcePort>);
    await settled();
    expect(service.submitGateClosed()).toBe(false);

    service.noteCheckStarted();
    // The red verdict lands before the settle (that is the real order in
    // `AgentPingService.check()`): no hold was latched, so it closes.
    service.noteAgentAlive(false);
    expect(service.submitGateReason()).toBe('agent-silent');

    service.noteCheckSettled();
    expect(service.submitGateReason()).toBe('agent-silent');
  });

  /**
   * `skillUpdateAvailable` drives the Settings attention dot, which is
   * why it lives here and not in the settings row: the dot must render
   * on a section the operator has not opened.
   */
  describe('skillUpdateAvailable (Settings attention dot)', () => {
    it('is true only when an INSTALLED copy is stale', async () => {
      const stale = bootstrap({
        getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true, 'claude', true)),
      });
      await settled();
      expect(stale.service.skillUpdateAvailable()).toBe(true);

      const current = bootstrap({
        getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
      });
      await settled();
      expect(current.service.skillUpdateAvailable()).toBe(false);
    });

    it('stays false when nothing is installed (a missing skill is not an update)', async () => {
      // User decision 2026-08-03: on a project that never wanted the
      // skill the dot would be lit forever, so absence never raises it.
      const { service } = bootstrap({
        getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, false, 'claude', true)),
      });
      await settled();
      expect(service.skillUpdateAvailable()).toBe(false);
      // ... while the submit gate DOES close: the two are independent.
      expect(service.skillMissing()).toBe(true);
    });

    it('is false while unknown, so a transport failure never lights the dot', async () => {
      const { service } = bootstrap({
        getAgentSkillInstallStatus: vi.fn().mockRejectedValue(new Error('down')),
      });
      await settled();
      expect(service.skillUpdateAvailable()).toBe(false);
    });

    it('clears on `noteSkillStatus` so an update performed in the UI settles the dot', async () => {
      const { service } = bootstrap({
        getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true, 'claude', true)),
      });
      await settled();
      expect(service.skillUpdateAvailable()).toBe(true);

      // The envelope `POST /api/agent/install` returns.
      service.noteSkillStatus({
        provider: 'claude',
        supported: true,
        skillDir: '.claude/skills',
        installed: true,
        stale: false,
      });
      expect(service.skillUpdateAvailable()).toBe(false);
      expect(service.skillMissing()).toBe(false);
    });

    it('re-lights on the next scan when the CLI ships a newer copy', async () => {
      const probe = vi
        .fn()
        .mockResolvedValueOnce(status(true, true))
        .mockResolvedValueOnce(status(true, true, 'claude', true));
      const { service, scanCompleted$ } = bootstrap({ getAgentSkillInstallStatus: probe });
      await settled();
      expect(service.skillUpdateAvailable()).toBe(false);

      scanCompleted$.next({} as IWsScanCompletedEvent);
      await settled();
      expect(service.skillUpdateAvailable()).toBe(true);
    });
  });
});

