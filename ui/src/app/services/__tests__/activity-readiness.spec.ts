import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { ActivityReadinessService } from '../activity-readiness';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import { WsEventStreamService } from '../../../services/ws-event-stream';
import type { IWsScanCompletedEvent } from '../../../models/ws-event';

/**
 * `ActivityReadinessService`, the shared hook-install probe that gates
 * the topbar Real Time toggle and the Settings > General switch.
 * Covers: boot probe, unsupported lens, fail-open on error,
 * scan.completed re-probe, and concurrent-refresh coalescing.
 */

interface IHarness {
  service: ActivityReadinessService;
  scanCompleted$: Subject<IWsScanCompletedEvent>;
  getActiveProvider: ReturnType<typeof vi.fn>;
  getActivityInstallStatus: ReturnType<typeof vi.fn>;
}

function lens(activeProvider: string): Record<string, unknown> {
  return { activeProvider, detected: [], source: 'config', selectable: [activeProvider], markerDrift: null };
}

function status(supported: boolean, installed: boolean): Record<string, unknown> {
  return {
    provider: 'claude',
    supported,
    installed,
    configPath: '.claude/settings.json',
    configWired: installed,
    bridgePresent: installed,
    events: 5,
  };
}

function bootstrap(stub: Partial<IDataSourcePort>): IHarness {
  TestBed.resetTestingModule();
  const scanCompleted$ = new Subject<IWsScanCompletedEvent>();
  const ws = { scanCompleted$ } as unknown as WsEventStreamService;
  TestBed.configureTestingModule({
    providers: [
      { provide: DATA_SOURCE, useValue: stub },
      { provide: WsEventStreamService, useValue: ws },
    ],
  });
  return {
    service: TestBed.inject(ActivityReadinessService),
    scanCompleted$,
    getActiveProvider: stub.getActiveProvider as ReturnType<typeof vi.fn>,
    getActivityInstallStatus: stub.getActivityInstallStatus as ReturnType<typeof vi.fn>,
  };
}

async function settled(): Promise<void> {
  // Two microtask hops cover the two awaited reads inside `probe()`.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('ActivityReadinessService', () => {
  it('probes on boot: supported + installed resolves true', async () => {
    const { service } = bootstrap({
      getActiveProvider: vi.fn().mockResolvedValue(lens('claude')),
      getActivityInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
    });
    expect(service.hookInstalled()).toBe(null); // pending
    await settled();
    expect(service.hookInstalled()).toBe(true);
  });

  it('supported but not installed resolves false; unsupported lens also resolves false', async () => {
    const notInstalled = bootstrap({
      getActiveProvider: vi.fn().mockResolvedValue(lens('claude')),
      getActivityInstallStatus: vi.fn().mockResolvedValue(status(true, false)),
    });
    await settled();
    expect(notInstalled.service.hookInstalled()).toBe(false);

    const unsupported = bootstrap({
      getActiveProvider: vi.fn().mockResolvedValue(lens('markdown')),
      // `installed: true` is deliberately nonsensical here: the guard
      // must key on `supported` first.
      getActivityInstallStatus: vi.fn().mockResolvedValue(status(false, true)),
    });
    await settled();
    expect(unsupported.service.hookInstalled()).toBe(false);
  });

  it('fails OPEN (null) when the probe errors', async () => {
    const { service } = bootstrap({
      getActiveProvider: vi.fn().mockRejectedValue(new Error('down')),
    });
    await settled();
    expect(service.hookInstalled()).toBe(null);
  });

  it('re-probes on scan.completed and adopts the new state', async () => {
    const getActivityInstallStatus = vi.fn().mockResolvedValue(status(true, false));
    const harness = bootstrap({
      getActiveProvider: vi.fn().mockResolvedValue(lens('claude')),
      getActivityInstallStatus,
    });
    await settled();
    expect(harness.service.hookInstalled()).toBe(false);

    // An `sm activity install claude` ran in a terminal; the next scan
    // tick must surface it.
    getActivityInstallStatus.mockResolvedValue(status(true, true));
    harness.scanCompleted$.next({
      type: 'scan.completed',
      timestamp: 1,
      data: {},
    } as IWsScanCompletedEvent);
    await settled();
    expect(harness.service.hookInstalled()).toBe(true);
  });

  it('coalesces concurrent refreshes onto one in-flight probe', async () => {
    const getActiveProvider = vi.fn().mockResolvedValue(lens('claude'));
    const { service } = bootstrap({
      getActiveProvider,
      getActivityInstallStatus: vi.fn().mockResolvedValue(status(true, true)),
    });
    // Constructor already fired one probe; these two must join it.
    const a = service.refresh();
    const b = service.refresh();
    expect(a).toBe(b);
    await settled();
    expect(getActiveProvider).toHaveBeenCalledTimes(1);

    // A refresh AFTER settlement starts a fresh probe.
    await service.refresh();
    expect(getActiveProvider).toHaveBeenCalledTimes(2);
  });
});
