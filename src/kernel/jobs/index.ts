/**
 * Barrel for the job-submit kernel helpers (Step 10 Phase A, queue
 * infrastructure). Pure, side-effect-free building blocks the CLI
 * `sm job submit` verb composes; the storage writes live in the SQLite
 * adapter (`kernel/adapters/sqlite/jobs.ts`), not here.
 */

export {
  computeContentHash,
  computePromptTemplateHash,
  type IContentHashInput,
} from './content-hash.js';
export { loadCanonicalPreamble } from './preamble.js';
export {
  renderJobContent,
  wrapUserContent,
  unescapeUserContentClose,
  USER_CONTENT_PLACEHOLDER,
  type IRenderJobContentInput,
} from './render.js';
export {
  resolveTtl,
  resolvePriority,
  type TResolvableAction,
} from './resolve.js';
export { generateExecutionId, generateJobId, generateNonce } from './ids.js';
export {
  InvalidTtlError,
  InvalidPriorityError,
  JobRenderError,
} from './errors.js';
