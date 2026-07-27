import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { AgentPingService, PING_TIMEOUT_MS } from '../agent-ping';
import { ProcessingAgentReadinessService } from '../processing-agent-readiness';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import { CollectionLoaderService } from '../../../services/collection-loader';
import { WsEventStreamService } from '../../../services/ws-event-stream';

/**
 * `AgentPingService`, the shared full-circuit probe behind both "Check
 * Agent" surfaces. Covers: the claim / timeout verdicts and what each
 * stamps on the readiness service, the check-hold bracket around every
 * run (started before the submit, settled after the verdict), the
 * single-flight coalescing, and `abandon()` settling an armed watch
 * with the neutral `abandoned` verdict instead of leaving the promise
 * (and the gate latch) wedged.
 */

interface IHarness {
  service: AgentPingService;
  jobEvents$: Subject<{ type: string; jobId?: string }>;
  readiness: {
    noteAgentAlive: ReturnType<typeof vi.fn>;
    noteCheckStarted: ReturnType<typeof vi.fn>;
    noteCheckSettled: ReturnType<typeof vi.fn>;
    refreshMcp: ReturnType<typeof vi.fn>;
  };
  submitNodeJob: ReturnType<typeof vi.fn>;
  cancelJob: ReturnType<typeof vi.fn>;
}

function bootstrap(nodePath = 'docs/a.md'): IHarness {
  TestBed.resetTestingModule();
  const jobEvents$ = new Subject<{ type: string; jobId?: string }>();
  const submitNodeJob = vi.fn().mockResolvedValue({ value: { jobId: 'j1' } });
  const cancelJob = vi.fn().mockResolvedValue(undefined);
  const readiness = {
    noteAgentAlive: vi.fn(),
    noteCheckStarted: vi.fn(),
    noteCheckSettled: vi.fn(),
    refreshMcp: vi.fn().mockResolvedValue(undefined),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: DATA_SOURCE, useValue: { submitNodeJob, cancelJob } as Partial<IDataSourcePort> },
      { provide: CollectionLoaderService, useValue: { nodes: () => [{ path: nodePath }] } },
      { provide: WsEventStreamService, useValue: { jobEvents$ } },
      { provide: ProcessingAgentReadinessService, useValue: readiness },
    ],
  });
  return {
    service: TestBed.inject(AgentPingService),
    jobEvents$,
    readiness,
    submitNodeJob,
    cancelJob,
  };
}

/** Microtask hops past the awaited submit, so the watch is armed. */
async function armed(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('AgentPingService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a claim inside the window is alive: stamps the verdict, re-reads MCP, releases the hold', async () => {
    const { service, jobEvents$, readiness } = bootstrap();
    const check = service.check();
    expect(readiness.noteCheckStarted).toHaveBeenCalledTimes(1);
    expect(readiness.noteCheckSettled).not.toHaveBeenCalled();

    await armed();
    jobEvents$.next({ type: 'job.claimed', jobId: 'j1' });
    expect(await check).toEqual({ verdict: 'alive' });
    expect(readiness.noteAgentAlive).toHaveBeenCalledWith(true);
    expect(readiness.refreshMcp).toHaveBeenCalledTimes(1);
    expect(readiness.noteCheckSettled).toHaveBeenCalledTimes(1);
    // The verdict lands BEFORE the latch drops, so the gate never
    // flashes an intermediate state between the two.
    expect(readiness.noteAgentAlive.mock.invocationCallOrder[0]).toBeLessThan(
      readiness.noteCheckSettled.mock.invocationCallOrder[0],
    );
  });

  it('silence for the whole window is no-agent: cancels the ping and stamps false', async () => {
    vi.useFakeTimers();
    const { service, readiness, cancelJob } = bootstrap();
    const check = service.check();
    await armed();
    await vi.advanceTimersByTimeAsync(PING_TIMEOUT_MS);
    expect(await check).toEqual({ verdict: 'no-agent' });
    expect(cancelJob).toHaveBeenCalledWith('j1');
    expect(readiness.noteAgentAlive).toHaveBeenCalledWith(false);
    expect(readiness.refreshMcp).not.toHaveBeenCalled();
    expect(readiness.noteCheckSettled).toHaveBeenCalledTimes(1);
  });

  it('single-flight: a second check joins the in-flight one, one hold bracket total', async () => {
    const { service, jobEvents$, readiness } = bootstrap();
    const first = service.check();
    const second = service.check();
    expect(second).toBe(first);
    expect(readiness.noteCheckStarted).toHaveBeenCalledTimes(1);

    await armed();
    jobEvents$.next({ type: 'job.claimed', jobId: 'j1' });
    await first;
    expect(readiness.noteCheckSettled).toHaveBeenCalledTimes(1);
  });

  it('abandon settles an armed watch as abandoned: no stamp, hold released, slot freed', async () => {
    const { service, jobEvents$, readiness, submitNodeJob, cancelJob } = bootstrap();
    const check = service.check();
    await armed();

    service.abandon();
    expect(await check).toEqual({ verdict: 'abandoned' });
    expect(cancelJob).toHaveBeenCalledWith('j1');
    expect(readiness.noteAgentAlive).not.toHaveBeenCalled();
    expect(readiness.noteCheckSettled).toHaveBeenCalledTimes(1);

    // The single-flight slot is free again: a new check runs end to end.
    const again = service.check();
    expect(again).not.toBe(check);
    await armed();
    jobEvents$.next({ type: 'job.claimed', jobId: 'j1' });
    expect(await again).toEqual({ verdict: 'alive' });
    expect(submitNodeJob).toHaveBeenCalledTimes(2);
  });

  it('no real node to aim at is no-node: nothing submitted, nothing stamped, bracket intact', async () => {
    const { service, readiness, submitNodeJob } = bootstrap('agy://mcp/foo');
    expect(await service.check()).toEqual({ verdict: 'no-node' });
    expect(submitNodeJob).not.toHaveBeenCalled();
    expect(readiness.noteAgentAlive).not.toHaveBeenCalled();
    expect(readiness.noteCheckStarted).toHaveBeenCalledTimes(1);
    expect(readiness.noteCheckSettled).toHaveBeenCalledTimes(1);
  });
});
