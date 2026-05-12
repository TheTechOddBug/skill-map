/**
 * Re-export shim, historical home of `truncateHead` / `truncateTail`.
 * Real implementation moved to `kernel/util/text.ts` so kernel-safe
 * presentation helpers live alongside the other text utilities
 * (`safe-text.ts`) and `core/runtime/plugin-runtime.ts` can consume
 * them without crossing into `src/cli/`. CLI consumers keep importing
 * from here unchanged.
 */

export { truncateHead, truncateTail } from '../../kernel/util/text.js';
