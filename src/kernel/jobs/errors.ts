/**
 * Typed errors raised by the job-submit helpers. The CLI maps each to a
 * spec exit code (`spec/cli-contract.md` §Exit codes):
 *
 *   - `InvalidTtlError` / `InvalidPriorityError` → operational error,
 *     exit 2 (bad flag value). `--ttl <= 0` and a non-integer
 *     `--priority` are the canonical triggers.
 *   - `JobRenderError` → operational error, exit 2 (the action's prompt
 *     template violates the `spec/prompt-preamble.md` delimiter contract:
 *     it never references the node-content placeholder, or it authors its
 *     own `<user-content>` block).
 *
 * They are plain `Error` subclasses so a caller that does not care about
 * the exit-code mapping (a unit test, a future BFF route) still gets a
 * readable message.
 */

import { tx } from '../util/tx.js';
import { JOB_TEXTS } from '../i18n/jobs.texts.js';

/** `--ttl <= 0` (or a non-integer TTL). Maps to exit 2. */
export class InvalidTtlError extends Error {
  readonly value: number;

  constructor(value: number) {
    super(tx(JOB_TEXTS.invalidTtl, { value }));
    this.name = 'InvalidTtlError';
    this.value = value;
  }
}

/** A non-integer `--priority`. Maps to exit 2. */
export class InvalidPriorityError extends Error {
  readonly value: number;

  constructor(value: number) {
    super(tx(JOB_TEXTS.invalidPriority, { value }));
    this.name = 'InvalidPriorityError';
    this.value = value;
  }
}

/** The action prompt template violates the delimiter contract. Maps to exit 2. */
export class JobRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobRenderError';
  }
}

/**
 * A terminal record (`recordJobTerminal`) lost the race: the guarded
 * `state_jobs` UPDATE matched zero rows because the job is no longer
 * `running` (reaped, cancelled, or failed out from under the callback
 * between the caller's pre-check and the transaction). Thrown INSIDE the
 * record transaction so the execution insert rolls back with it and no
 * orphan `state_executions` row documents a run that never closed a job.
 * `sm record` maps it to the "job not in running state" exit 2 path.
 */
export class JobNotRunningError extends Error {
  readonly jobId: string;

  constructor(jobId: string) {
    super(tx(JOB_TEXTS.jobNotRunning, { id: jobId }));
    this.name = 'JobNotRunningError';
    this.jobId = jobId;
  }
}
