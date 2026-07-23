/**
 * `ProgressEmitterPort`, emits progress events during long operations.
 *
 * Shape-only today. The full event catalog (`run.started`,
 * `job.claimed`, `model.delta`, etc.) is normative in
 * `spec/job-events.md`; this port carries an open `data` payload so
 * adapters can emit any documented event without type churn.
 */

export interface ProgressEvent {
  type: string;
  /**
   * Job-event envelopes (`spec/job-events.md`) carry Unix milliseconds
   * (number, normative in the ndjson stream). The experimental scan /
   * extension families still emit ISO strings; they unify on numbers
   * when promoted to stable.
   */
  timestamp: number | string;
  runId?: string;
  /** Null on run-level events (`run.*`), per the envelope contract. */
  jobId?: string | null;
  data?: unknown;
}

export type TProgressListener = (event: ProgressEvent) => void;

export interface ProgressEmitterPort {
  emit(event: ProgressEvent): void;
  subscribe(listener: TProgressListener): () => void;
}
