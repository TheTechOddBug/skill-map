/**
 * `RunnerPort`, executes an action's rendered job content against an LLM
 * (spec `architecture.md` §RunnerPort).
 *
 * `jobContent` is a STRING: the kernel reads `state_job_contents` for the
 * job and passes the rendered content directly. No on-disk job file is part
 * of the contract; a runner that needs one (e.g. `claude -p`) materializes
 * a temp file inside `run()` and deletes it after spawn (operational, not
 * normative). Likewise there is no on-disk report artifact: the produced
 * report rides back inline on `IRunResult.reportJson` and the caller
 * ingests it into `state_executions.report_json`.
 *
 * Reference implementations (`kernel/adapters/runner/`):
 *   - `ClaudeCliRunner`, `claude -p` subprocess (content piped via stdin).
 *   - `MockRunner`, deterministic fake for tests.
 *
 * The **Skill agent** does NOT implement this port: it is a peer driving
 * adapter consuming `sm job claim` + `sm record` as a kernel client.
 */

export interface IRunOptions {
  /**
   * Wall-clock budget for the run. The CLI-runner loop derives it from the
   * claimed job's frozen `ttlSeconds` (capped); an implementation MUST kill
   * its subprocess on expiry and surface the outcome as a failed run (a
   * non-zero `exitCode`), never hang past the budget.
   */
  timeoutMs?: number;
  /** Optional model override forwarded to the underlying LLM adapter. */
  model?: string;
}

export interface IRunResult {
  /**
   * The report payload the runner produced, as JSON text, ingested by the
   * record path into `state_executions.report_json`. DB-only job model:
   * there is no on-disk report artifact the kernel retains. On a failed run
   * this MAY carry the raw output / error excerpt instead of valid JSON
   * (the caller records it as the failure detail, never as a report).
   */
  reportJson: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  exitCode: number;
}

export interface RunnerPort {
  run(jobContent: string, options?: IRunOptions): Promise<IRunResult>;
}
