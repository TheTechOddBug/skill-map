/**
 * Re-export shim, the runtime-context body was moved to
 * `core/runtime/runtime-context.ts` so the BFF can consume it without
 * crossing the CLI boundary. Historic CLI imports keep working
 * verbatim through this file.
 */

export {
  defaultRuntimeContext,
  type IRuntimeContext,
} from '../../core/runtime/runtime-context.js';
