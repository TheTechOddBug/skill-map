/**
 * Re-export shim, historical home of `createCliProgressEmitter`. Real
 * implementation moved to `core/runtime/progress-emitter.ts` (renamed
 * `createStderrProgressEmitter`, the helper is stream-based and never
 * was CLI-specific) so the scan-runner and BFF can consume the
 * abstraction without crossing into `src/cli/`. CLI consumers keep
 * importing the historical name from here unchanged.
 */

export { createStderrProgressEmitter as createCliProgressEmitter } from '../../core/runtime/progress-emitter.js';
