/**
 * `RunnerPort`, executes an action against a rendered job file.
 *
 * Shape-only. `ClaudeCliRunner` + `MockRunner` land with the job subsystem
 * (job subsystem + first summarizer).
 */

export interface IRunOptions {
  timeoutMs?: number;
  model?: string;
}

export interface IRunResult {
  /**
   * The report payload the runner produced, as JSON text, ingested by
   * `sm record` into `state_executions.report_json`. DB-only job model:
   * there is no on-disk report artifact the kernel retains.
   */
  reportJson: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  exitCode: number;
}

export interface RunnerPort {
  run(jobFilePath: string, options?: IRunOptions): Promise<IRunResult>;
}
