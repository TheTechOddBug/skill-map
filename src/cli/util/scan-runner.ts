/**
 * Re-export shim, `runScanForCommand` was moved to
 * `core/runtime/scan-runner.ts` so the BFF can consume it without
 * crossing the CLI boundary. Historic CLI imports keep working
 * verbatim through this file.
 */

export {
  runScanForCommand,
  type IScanRunOpts,
  type IScanRunResult,
} from '../../core/runtime/scan-runner.js';
