import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { AgentPingService, PING_ANSWER_TIMEOUT_MS, PING_TIMEOUT_MS } from '../agent-ping';
import { ProcessingAgentReadinessService } from '../processing-agent-readiness';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
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
  };
  submitNodelessJob: ReturnType<typeof vi.fn>;
  cancelJob: ReturnType<typeof vi.fn>;
}

function bootstrap(): IHarness {
  TestBed.resetTestingModule();
  const jobEvents$ = new Subject<{ type: string; jobId?: string }>();
  const submitNodelessJob = vi.fn().mockResolvedValue({ value: { jobId: 'j1' } });
  const cancelJob = vi.fn().mockResolvedValue(undefined);
  const readiness = {
    noteAgentAlive: vi.fn(),
    noteCheckStarted: vi.fn(),
    noteCheckSettled: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      {
        provide: DATA_SOURCE,
        useValue: { submitNodelessJob, cancelJob } as Partial<IDataSourcePort>,
      },
      { provide: WsEventStreamService, useValue: { jobEvents$ } },
      { provide: ProcessingAgentReadinessService, useValue: readiness },
    ],
  });
  return {
    service: TestBed.inject(AgentPingService),
    jobEvents$,
    readiness,
    submitNodelessJob,
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

  it('an ANSWER inside the window is alive: stamps the verdict, releases the hold', async () => {
    const { service, jobEvents$, readiness } = bootstrap();
    const check = service.check();
    expect(readiness.noteCheckStarted).toHaveBeenCalledTimes(1);
    expect(readiness.noteCheckSettled).not.toHaveBeenCalled();

    await armed();
    jobEvents$.next({ type: 'job.completed', jobId: 'j1' });
    expect(await check).toEqual({ verdict: 'alive' });
    expect(readiness.noteAgentAlive).toHaveBeenCalledWith(true);
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
    expect(readiness.noteCheckSettled).toHaveBeenCalledTimes(1);
  });

  it('single-flight: a second check joins the in-flight one, one hold bracket total', async () => {
    const { service, jobEvents$, readiness } = bootstrap();
    const first = service.check();
    const second = service.check();
    expect(second).toBe(first);
    expect(readiness.noteCheckStarted).toHaveBeenCalledTimes(1);

    await armed();
    jobEvents$.next({ type: 'job.completed', jobId: 'j1' });
    await first;
    expect(readiness.noteCheckSettled).toHaveBeenCalledTimes(1);
  });

  it('abandon settles an armed watch as abandoned: no stamp, hold released, slot freed', async () => {
    const { service, jobEvents$, readiness, submitNodelessJob, cancelJob } = bootstrap();
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
    jobEvents$.next({ type: 'job.completed', jobId: 'j1' });
    expect(await again).toEqual({ verdict: 'alive' });
    expect(submitNodelessJob).toHaveBeenCalledTimes(2);
  });

  /**
   * The regression this phase split is about: an agent parked on
   * `sm jobs claim --wait` picks the ping up within one poll cycle, so
   * resolving on the claim reported "an agent is answering" before the
   * model had read a line of the prompt.
   */
  it('a claim alone does NOT resolve: it only moves the check to its second phase', async () => {
    vi.useFakeTimers();
    const { service, jobEvents$, readiness } = bootstrap();
    const check = service.check();
    await armed();

    jobEvents$.next({ type: 'job.claimed', jobId: 'j1' });
    await Promise.resolve();
    // Still in flight, and the surfaces can now say "picked it up".
    expect(service.claimed()).toBe(true);
    expect(readiness.noteAgentAlive).not.toHaveBeenCalled();

    // Past the CLAIM window: a claimed ping is not abandoned as no-agent.
    await vi.advanceTimersByTimeAsync(PING_TIMEOUT_MS);
    expect(readiness.noteAgentAlive).not.toHaveBeenCalled();

    jobEvents$.next({ type: 'job.completed', jobId: 'j1' });
    expect(await check).toEqual({ verdict: 'alive' });
    expect(readiness.noteAgentAlive).toHaveBeenCalledWith(true);
    expect(service.claimed()).toBe(false);
  });

  it('claimed and silent past the answer window is no-answer: the job is left alone', async () => {
    vi.useFakeTimers();
    const { service, jobEvents$, readiness, cancelJob } = bootstrap();
    const check = service.check();
    await armed();
    jobEvents$.next({ type: 'job.claimed', jobId: 'j1' });
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(PING_ANSWER_TIMEOUT_MS);
    expect(await check).toEqual({ verdict: 'no-answer' });
    // NOT cancelled: the agent still holds it and may record it late;
    // cancelling would make that record fail for nothing.
    expect(cancelJob).not.toHaveBeenCalled();
    // Says nothing about the agent either way, so it stamps nothing.
    expect(readiness.noteAgentAlive).not.toHaveBeenCalled();
    expect(readiness.noteCheckSettled).toHaveBeenCalledTimes(1);
  });

  /**
   * The probe takes NO node (`probNodeless`), so an empty or fully virtual
   * corpus is no longer a reason it cannot run: it submits regardless, and
   * the verdict stays about the AGENT. This replaces the old `no-node`
   * case, where the check gave up without ever asking the queue.
   */
  it('submits without a node: an empty corpus still gets a verdict', async () => {
    const { service, jobEvents$, submitNodelessJob } = bootstrap();
    const check = service.check();
    await armed();
    expect(submitNodelessJob).toHaveBeenCalledWith('core/ai-ping-action');
    jobEvents$.next({ type: 'job.completed', jobId: 'j1' });
    expect(await check).toEqual({ verdict: 'alive' });
  });
});
