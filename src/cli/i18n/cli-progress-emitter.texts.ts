/**
 * Re-export shim — historical home of `CLI_PROGRESS_EMITTER_TEXTS`.
 * Real catalogue moved to `core/runtime/i18n/progress-emitter.texts.ts`
 * so the kernel-side runtime can render stderr lines without crossing
 * into `src/cli/`. The exported name is kept for backwards
 * compatibility with any CLI tests that still reference it.
 */

export { PROGRESS_EMITTER_TEXTS as CLI_PROGRESS_EMITTER_TEXTS } from '../../core/runtime/i18n/progress-emitter.texts.js';
