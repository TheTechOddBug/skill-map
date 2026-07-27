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
 * concurrent-refresh coalescing; then the MCP half of the same gate
 * (reason precedence, fail-open, and the unattached-MCP poll that
 * reopens the gate when the operator finally starts their agent), and
 * the check hold that latches a closed gate while a manual check runs.
 */

interface IHarness {
  service: ProcessingAgentReadinessService;
  scanCompleted$: Subject<IWsScanCompletedEvent>;
  jobEvents$: Subject<{ type: string; jobId?: string }>;
  activeProvider: WritableSignal<string | null>;
  getAgentSkillInstallStatus: ReturnType<typeof vi.fn>;
}

function status(supported: boolean, installed: boolean, provider = 'claude'): Record<string, unknown> {
  return {
    provider,
    supported,
    skillDir: supported ? '.claude/skills/sm-process-jobs' : null,
    installed,
    stale: false,
  };
}

/** `GET /api/mcp/status` payload: is `/mcp` exposed, is anyone attached. */
function mcp(enabled: boolean, connected: boolean): Record<string, unknown> {
  return {
    enabled,
    connected,
    clients: connected ? 1 : 0,
    url: 'http://127.0.0.1:4242/mcp',
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
    expect(service.skillMissing()).toBe(null); // pending, fails open
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

  it('fails OPEN (null) when the probe errors', async () => {
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockRejectedValue(new Error('down')),
    });
    await settled();
    expect(service.skillMissing()).toBe(null);
  });

  it('fails OPEN (null) and never probes while no lens is resolved', async () => {
    const getAgentSkillInstallStatus = vi.fn().mockResolvedValue(status(true, false));
    const { service } = bootstrap({ getAgentSkillInstallStatus }, null);
    await settled();
    expect(service.skillMissing()).toBe(null);
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

  /**
   * The MCP half of the gate (user call 2026-07-25): an installed skill
   * is not enough, something has to be ATTACHED to drain the queue, so
   * a live `/mcp` with zero clients closes the gate on its own.
   */
  it('closes the gate when no agent is attached to the MCP, naming the reason', async () => {
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
      mcpStatus: vi.fn().mockResolvedValue(mcp(true, false)),
    });
    await settled();
    expect(service.skillMissing()).toBe(false); // installed, that half is open
    expect(service.mcpConnected()).toBe(false);
    expect(service.submitGateReason()).toBe('mcp-disconnected');
    expect(service.submitGateClosed()).toBe(true);
  });

  it('a missing skill wins over the MCP half (the deeper problem names itself)', async () => {
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, false)),
      mcpStatus: vi.fn().mockResolvedValue(mcp(true, false)),
    });
    await settled();
    expect(service.submitGateReason()).toBe('skill-missing');
  });

  it('an attached agent opens the gate; an MCP probe error fails OPEN', async () => {
    const attached = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
      mcpStatus: vi.fn().mockResolvedValue(mcp(true, true)),
    });
    await settled();
    expect(attached.service.submitGateClosed()).toBe(false);

    const broken = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
      mcpStatus: vi.fn().mockRejectedValue(new Error('down')),
    });
    await settled();
    expect(broken.service.mcpConnected()).toBe(null);
    expect(broken.service.submitGateClosed()).toBe(false);
  });

  it('polls while /mcp is live and unattached, then stops once an agent connects', async () => {
    vi.useFakeTimers();
    try {
      const mcpStatus = vi.fn().mockResolvedValue(mcp(true, false));
      const { service } = bootstrap({
        getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
        mcpStatus,
      });
      await settled();
      TestBed.tick(); // flush the effect that arms the poll
      expect(service.submitGateClosed()).toBe(true);
      expect(mcpStatus).toHaveBeenCalledTimes(1); // boot probe only

      // The operator starts the agent: the next tick must reopen the
      // gate with no scan, no lens change and no navigation.
      mcpStatus.mockResolvedValue(mcp(true, true));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mcpStatus).toHaveBeenCalledTimes(2);
      expect(service.mcpConnected()).toBe(true);
      expect(service.submitGateClosed()).toBe(false);

      // ...and the timer is disarmed, no idle polling forever.
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mcpStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never polls a DISABLED /mcp (turning it on needs a server restart)', async () => {
    vi.useFakeTimers();
    try {
      const mcpStatus = vi.fn().mockResolvedValue(mcp(false, false));
      const { service } = bootstrap({
        getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
        mcpStatus,
      });
      await settled();
      TestBed.tick();
      // Still CLOSED: nothing is attached, whatever the reason.
      expect(service.submitGateClosed()).toBe(true);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mcpStatus).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
      mcpStatus: vi.fn().mockResolvedValue(mcp(true, true)),
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

  it('the deeper halves outrank agent-silent when both are closed', async () => {
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, false)),
      mcpStatus: vi.fn().mockResolvedValue(mcp(true, false)),
    } as Partial<IDataSourcePort>);
    await settled();
    service.noteAgentAlive(false);
    expect(service.submitGateReason()).toBe('skill-missing');
  });

  it('any observed job.claimed heals a failed check live', async () => {
    const { service, jobEvents$ } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
      mcpStatus: vi.fn().mockResolvedValue(mcp(true, true)),
    } as Partial<IDataSourcePort>);
    await settled();
    service.noteAgentAlive(false);
    expect(service.submitGateClosed()).toBe(true);

    jobEvents$.next({ type: 'job.claimed', jobId: 'd-x' });
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
    const mcpStatus = vi.fn().mockResolvedValue(mcp(true, false));
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
      mcpStatus,
    } as Partial<IDataSourcePort>);
    await settled();
    expect(service.submitGateReason()).toBe('mcp-disconnected');

    service.noteCheckStarted();
    // The agent attaches mid-check: the live reading flips open, but
    // the gate must hold the starting reason until the verdict lands.
    mcpStatus.mockResolvedValue(mcp(true, true));
    await service.refreshMcp();
    expect(service.mcpConnected()).toBe(true);
    expect(service.submitGateReason()).toBe('mcp-disconnected');
    expect(service.submitGateClosed()).toBe(true);

    service.noteCheckSettled();
    expect(service.submitGateClosed()).toBe(false);
  });

  it('the claim heal also waits out the hold', async () => {
    const { service, jobEvents$ } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
      mcpStatus: vi.fn().mockResolvedValue(mcp(true, true)),
    } as Partial<IDataSourcePort>);
    await settled();
    service.noteAgentAlive(false);
    expect(service.submitGateReason()).toBe('agent-silent');

    service.noteCheckStarted();
    jobEvents$.next({ type: 'job.claimed', jobId: 'd-x' });
    // Healed underneath, but the gate stays latched until the check
    // settles (in real flow that follows the claim within microtasks).
    expect(service.agentAlive()).toBe(true);
    expect(service.submitGateClosed()).toBe(true);

    service.noteCheckSettled();
    expect(service.submitGateClosed()).toBe(false);
  });

  it('never freezes an OPEN gate open: a mid-check close still lands', async () => {
    const mcpStatus = vi.fn().mockResolvedValue(mcp(true, true));
    const { service } = bootstrap({
      getAgentSkillInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
      mcpStatus,
    } as Partial<IDataSourcePort>);
    await settled();
    expect(service.submitGateClosed()).toBe(false);

    service.noteCheckStarted();
    mcpStatus.mockResolvedValue(mcp(true, false));
    await service.refreshMcp();
    expect(service.submitGateReason()).toBe('mcp-disconnected');

    service.noteCheckSettled();
    expect(service.submitGateReason()).toBe('mcp-disconnected');
  });
});

