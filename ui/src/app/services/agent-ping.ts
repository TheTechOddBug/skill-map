/**
 * `AgentPingService`, the ONE implementation of the full-circuit agent
 * probe: submit a `core/ai-ping-action` job, then watch the live job
 * stream for a claim. A claim (or completion /
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
 *
 * The verdict is the ANSWER, never the claim. An agent parked on
 * `sm jobs claim --wait` picks the ping up within one poll cycle, so
 * resolving on `job.claimed` reported "an agent is answering" before the
 * model had read a line of it. `alive` now requires `job.completed` /
 * `job.failed`; the claim only moves the check into its second phase
 * (`claimed`), which surfaces as "picked it up, waiting" on the row.
 *
 * The probe takes NO node. `core/ai-ping-action` declares `probNodeless`
 * (`spec/job-lifecycle.md` §Submit · Nodeless submit), so the submit runs
 * against a synthetic target and this service never picks a file. It used
 * to aim at the first non-virtual node of the loaded branch, which made a
 * question about the AGENT depend on the state of an arbitrary file: one
 * deleted since the last scan (a stale graph is normal, it is a cache) got
 * the raw server refusal surfaced as "Something went wrong", and a project
 * with nothing scanned yet could not be probed at all.
 */

import { Injectable, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';

import { DATA_SOURCE } from '../../services/data-source/data-source.port';
import { DataSourceError } from '../../services/data-source/data-source.port';
import { WsEventStreamService } from '../../services/ws-event-stream';
import { ProcessingAgentReadinessService } from './processing-agent-readiness';

/** The hidden liveness probe extension (locked built-in, never listed). */
export const PING_EXTENSION_ID = 'core/ai-ping-action';

/** How long a queued ping may sit UNCLAIMED before the verdict is no-agent. */
export const PING_TIMEOUT_MS = 15_000;

/**
 * How long an agent that CLAIMED the ping gets to answer it before the
 * check gives up. A separate, longer window than the one above, because
 * the two silences mean different things: nobody picked the work up, vs.
 * somebody did and never came back. Sized off the probe's own
 * `probExpectedDurationSeconds` (30s) plus room for a slow model.
 */
export const PING_ANSWER_TIMEOUT_MS = 45_000;

/**
 * Terminal verdicts of one circuit check:
 *   - `alive`: an agent claimed the ping inside the window.
 *   - `no-agent`: nobody claimed in time (the queued ping was cancelled),
 *     or the submit was refused because the processing skill is missing.
 *   - `no-answer`: an agent CLAIMED the ping and never answered inside the
 *     answer window. Different from `no-agent` on purpose: something is
 *     attending the queue, it just did not come back (a wedged agent, a
 *     model still thinking, a crashed runner). The job is left alone, the
 *     agent still holds it and may yet record it.
 *   - `error`: transport / unexpected submit failure (`message` set).
 *   - `abandoned`: the surface abandoned the check mid-watch
 *     (`abandon()`); says nothing about the agent, stamps nothing.
 */
export type TPingVerdict = 'alive' | 'no-agent' | 'no-answer' | 'error' | 'abandoned';

export interface IPingResult {
  verdict: TPingVerdict;
  /** Human-readable failure, only on `verdict: 'error'`. */
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class AgentPingService {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly wsEvents = inject(WsEventStreamService);
  private readonly readiness = inject(ProcessingAgentReadinessService);

  /**
   * True while the in-flight check sits in its second phase: an agent
   * claimed the ping and the answer is still pending. Read by the row
   * surfaces to distinguish "asking" from "somebody is working on it".
   * Reset at the start of every check and on teardown.
   */
  private readonly _claimed = signal(false);
  readonly claimed = this._claimed.asReadonly();

  private inFlight: Promise<IPingResult> | null = null;
  private jobId: string | null = null;
  private sub: Subscription | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Resolver of the armed watch, so `abandon()` can settle it. */
  private settleWatch: ((result: IPingResult) => void) | null = null;

  /** Run one full-circuit check (single-flight; see the file header). */
  check(): Promise<IPingResult> {
    if (this.inFlight !== null) return this.inFlight;
    // Latch a closed gate for the whole check window (user spec
    // 2026-07-27): the side probes riding along with the check must not
    // reopen the AI affordances before the verdict itself does.
    this.readiness.noteCheckStarted();
    const run = this.run()
      .then((result) => {
        // The check has AUTHORITY over the connected state (user spec
        // 2026-07-26): a red verdict closes the submit gate (every
        // probabilistic affordance disables) until a claim or a green
        // check reopens it. `error` / `abandoned` say nothing about the
        // agent and stamp nothing.
        if (result.verdict === 'alive') this.readiness.noteAgentAlive(true);
        if (result.verdict === 'no-agent') this.readiness.noteAgentAlive(false);
        return result;
      })
      .finally(() => {
        this.readiness.noteCheckSettled();
        if (this.inFlight === run) this.inFlight = null;
      });
    this.inFlight = run;
    return run;
  }

  /**
   * Cancel a still-queued ping and tear the watch down (surface
   * closing mid-check). An armed watch settles immediately with the
   * neutral `abandoned` verdict (it stamps no connected state and just
   * releases the check hold; leaving the promise pending would wedge
   * the single-flight slot AND the gate latch for the session). Before
   * the watch is armed (submit still in flight) there is nothing to
   * settle yet; that run still resolves through its own claim /
   * timeout path.
   */
  abandon(): void {
    if (this.jobId !== null) {
      void this.dataSource.cancelJob(this.jobId).catch(() => undefined);
    }
    const settle = this.settleWatch;
    this.teardown();
    settle?.({ verdict: 'abandoned' });
  }

  private async run(): Promise<IPingResult> {
    this.teardown();
    this._claimed.set(false);
    try {
      const envelope = await this.dataSource.submitNodelessJob(PING_EXTENSION_ID);
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

  /**
   * Watch the job stream for this ping id through both phases: waiting for
   * a claim, then waiting for the answer that claim promises.
   */
  private watch(jobId: string): Promise<IPingResult> {
    this.jobId = jobId;
    return new Promise<IPingResult>((resolve) => {
      this.settleWatch = resolve;
      this.sub = this.wsEvents.jobEvents$.subscribe((event) => {
        if (event.jobId !== jobId) return;
        // The ANSWER, either way: the agent went through the whole
        // circuit and came back. A `failed` still required running it.
        if (event.type === 'job.completed' || event.type === 'job.failed') {
          this.teardown();
          resolve({ verdict: 'alive' });
          return;
        }
        // A claim is a receipt, not an answer. It only tells us someone
        // is on it, so the check moves to its second phase: report the
        // progress and re-arm on the longer answer window.
        if (event.type === 'job.claimed') this.enterClaimedPhase(resolve);
      });
      this.armTimer(() => {
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

  /**
   * Second phase: an agent holds the ping. Publish the progress so both
   * surfaces can say "picked it up, waiting", and swap the claim window
   * for the answer window. On expiry the job is deliberately NOT
   * cancelled: the agent still holds it and may record it late, and
   * cancelling would make that record fail for no reason.
   */
  private enterClaimedPhase(resolve: (result: IPingResult) => void): void {
    this._claimed.set(true);
    this.armTimer(() => {
      this.teardown();
      resolve({ verdict: 'no-answer' });
    }, PING_ANSWER_TIMEOUT_MS);
  }

  /** Replace the pending window with a fresh one. */
  private armTimer(onExpiry: () => void, ms: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(onExpiry, ms);
  }

  /** Drop the watch subscription + timer + resolver + job id (idempotent). */
  private teardown(): void {
    if (this.sub !== null) {
      this.sub.unsubscribe();
      this.sub = null;
    }
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.settleWatch = null;
    this.jobId = null;
    this._claimed.set(false);
  }
}
