/**
 * Barrel for the `RunnerPort` adapters (spec `architecture.md`
 * §Implementation layout: `kernel/adapters/runner/`).
 */

export {
  ClaudeCliNotFoundError,
  ClaudeCliRunner,
  extractReportJson,
  extractRunReport,
  probeClaudeCli,
  TIMEOUT_EXIT_CODE,
  type IClaudeCliProbe,
  type IClaudeCliRunnerOptions,
  type IExtractedReport,
} from './claude-cli.js';
export { MockRunner, type IMockRunCall, type IMockRunStep } from './mock.js';
