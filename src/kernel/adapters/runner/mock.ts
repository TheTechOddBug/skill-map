/**
 * `MockRunner`, the deterministic `RunnerPort` fake for tests (spec
 * `architecture.md` §RunnerPort names it as the second reference impl).
 *
 * Configured with a script of canned results: each `run()` call consumes
 * the next step (the last step repeats once the script is exhausted, so a
 * single-step script behaves as a constant). A step can also simulate
 * latency or throw a supplied error (e.g. `ClaudeCliNotFoundError`) to
 * exercise the CLI-runner loop's abort path. Every call is recorded on
 * `calls` for assertions on order and content.
 */

import type { IRunOptions, IRunResult, RunnerPort } from '../../ports/runner.js';

export interface IMockRunStep {
  /** Report payload to return. Default `'{}'`. */
  reportJson?: string;
  /** Metric fields on the returned `IRunResult`. Default `0` each. */
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  /** Subprocess exit code to report. Default `0`. */
  exitCode?: number;
  /** Simulated latency before resolving (ms). Default none. */
  latencyMs?: number;
  /** When set, `run()` rejects with this error instead of resolving. */
  error?: Error;
}

export interface IMockRunCall {
  jobContent: string;
  options: IRunOptions | undefined;
}

export class MockRunner implements RunnerPort {
  /** Every `run()` invocation, in call order. */
  readonly calls: IMockRunCall[] = [];
  private readonly script: IMockRunStep[];

  constructor(script: IMockRunStep | IMockRunStep[] = {}) {
    this.script = Array.isArray(script) ? script : [script];
  }

  async run(jobContent: string, options?: IRunOptions): Promise<IRunResult> {
    const index = Math.min(this.calls.length, this.script.length - 1);
    const step = this.script[index] ?? {};
    this.calls.push({ jobContent, options });
    if (step.latencyMs !== undefined && step.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, step.latencyMs));
    }
    if (step.error !== undefined) throw step.error;
    return toRunResult(step);
  }
}

/** Fill the canned step's defaults into a full `IRunResult`. */
function toRunResult(step: IMockRunStep): IRunResult {
  return {
    reportJson: step.reportJson ?? '{}',
    tokensIn: step.tokensIn ?? 0,
    tokensOut: step.tokensOut ?? 0,
    durationMs: step.durationMs ?? 0,
    exitCode: step.exitCode ?? 0,
  };
}
