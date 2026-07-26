/**
 * `AgentPingService`, the ONE implementation of the full-circuit agent
 * probe: submit a `core/ai-ping-action` job against a real node, then
 * watch the live job stream for a claim. A claim (or completion /
 * failure, both require one) proves an external agent is attending the
 * queue end to end, submit gate through claim path included; silence
 * for the whole window means nobody is, and the still-queued ping is
 * cancelled so it does not sit in the queue forever (jobs never
 * auto-expire).
 *
 * Extracted from the Quick Start modal (2026-07-26) when the
 * inspector's "Check Agent" chip gained the same probe: both surfaces
 * now share this service instead of each keeping its own copy of the
 * submit + adopt + watch + timeout machinery.
 *
 * Single-flight: a check while one is in flight returns the in-flight
 * promise, so two surfaces clicking at once still submit ONE ping.
 */

import { Injectable, inject } from '@angular/core';
import type { Subscription } from 'rxjs';

import { DATA_SOURCE } from '../../services/data-source/data-source.port';
import { DataSourceError } from '../../services/data-source/data-source.port';
import { CollectionLoaderService } from '../../services/collection-loader';
import { WsEventStreamService } from '../../services/ws-event-stream';
import { ProcessingAgentReadinessService } from './processing-agent-readiness';

/** The hidden liveness probe extension (locked built-in, never listed). */
export const PING_EXTENSION_ID = 'core/ai-ping-action';

/** How long a queued ping may sit unclaimed before the verdict is no-agent. */
export const PING_TIMEOUT_MS = 15_000;

/**
 * Terminal verdicts of one circuit check:
 *   - `alive`: an agent claimed the ping inside the window.
 *   - `no-agent`: nobody claimed in time (the queued ping was cancelled),
 *     or the submit was refused because the processing skill is missing.
 *   - `no-node`: nothing real is scanned yet to aim the ping at.
 *   - `error`: transport / unexpected submit failure (`message` set).
 */
export type TPingVerdict = 'alive' | 'no-agent' | 'no-node' | 'error';

export interface IPingResult {
  verdict: TPingVerdict;
  /** Human-readable failure, only on `verdict: 'error'`. */
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class AgentPingService {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly loader = inject(CollectionLoaderService);
  private readonly wsEvents = inject(WsEventStreamService);
  private readonly readiness = inject(ProcessingAgentReadinessService);

  private inFlight: Promise<IPingResult> | null = null;
  private jobId: string | null = null;
  private sub: Subscription | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Run one full-circuit check (single-flight; see the file header). */
  check(): Promise<IPingResult> {
    if (this.inFlight !== null) return this.inFlight;
    const run = this.run()
      .then((result) => {
        // The check has AUTHORITY over the connected state (user spec
        // 2026-07-26): a red verdict closes the submit gate (every
        // probabilistic affordance disables) until a claim or a green
        // check reopens it. `no-node` / `error` say nothing about the
        // agent and stamp nothing.
        if (result.verdict === 'alive') this.readiness.noteAgentAlive(true);
        if (result.verdict === 'no-agent') this.readiness.noteAgentAlive(false);
        return result;
      })
      .finally(() => {
        if (this.inFlight === run) this.inFlight = null;
      });
    this.inFlight = run;
    return run;
  }

  /**
   * Cancel a still-queued ping and tear the watch down (surface
   * closing mid-check). The in-flight promise still resolves, with
   * `no-agent`, via its own timeout path if nothing claims first.
   */
  abandon(): void {
    if (this.jobId !== null) {
      void this.dataSource.cancelJob(this.jobId).catch(() => undefined);
    }
    this.teardown();
  }

  private async run(): Promise<IPingResult> {
    this.teardown();
    // The submit engine reads the target's body from disk, so the ping
    // must aim at a REAL file, never a virtual `<scheme>://` node.
    const target = this.loader.nodes().find((n) => !n.path.includes('://'))?.path ?? null;
    if (target === null) return { verdict: 'no-node' };
    try {
      const envelope = await this.dataSource.submitNodeJob(target, PING_EXTENSION_ID);
      return await this.watch(envelope.value.jobId);
    } catch (err) {
      if (err instanceof DataSourceError && err.code === 'no-processing-agent') {
        // The skill vanished between the caller's probe and this submit.
        return { verdict: 'no-agent' };
      }
      if (
        err instanceof DataSourceError &&
        (err.code === 'duplicate-job' || err.code === 'job-running')
      ) {
        // A prior job already covers this node, commonly a ping a past
        // check left unclaimed because no agent was draining. Adopt it
        // as the probe instead of surfacing an error: if an agent is
        // attending it claims within the window; otherwise the timeout
        // cancels it and reports no-agent, which also clears the wedged
        // job so the next check starts clean.
        const existingId = (err.details as { existingId?: unknown } | undefined)?.existingId;
        if (typeof existingId === 'string') return await this.watch(existingId);
        return { verdict: 'no-agent' };
      }
      return { verdict: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Watch the job stream for this ping id and arm the timeout window. */
  private watch(jobId: string): Promise<IPingResult> {
    this.jobId = jobId;
    return new Promise<IPingResult>((resolve) => {
      this.sub = this.wsEvents.jobEvents$.subscribe((event) => {
        if (event.jobId !== jobId) return;
        // Any of these means an external agent CLAIMED the ping, so it
        // is attending the queue (a failure still required a claim).
        if (
          event.type === 'job.claimed' ||
          event.type === 'job.completed' ||
          event.type === 'job.failed'
        ) {
          this.teardown();
          resolve({ verdict: 'alive' });
        }
      });
      this.timer = setTimeout(() => {
        // Nobody claimed it in time: no agent attending. Cancel the
        // queued ping so it does not linger (jobs never auto-expire).
        if (this.jobId !== null) {
          void this.dataSource.cancelJob(this.jobId).catch(() => undefined);
        }
        this.teardown();
        resolve({ verdict: 'no-agent' });
      }, PING_TIMEOUT_MS);
    });
  }

  /** Drop the watch subscription + timer + job id (idempotent). */
  private teardown(): void {
    if (this.sub !== null) {
      this.sub.unsubscribe();
      this.sub = null;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.jobId = null;
  }
}
