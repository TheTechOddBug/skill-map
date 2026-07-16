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
  resolveSubmitTarget,
  type ISubmitTargetExtension,
  type TResolvableAction,
  type TSubmitTargetResolution,
} from './resolve.js';
export { generateExecutionId, generateJobId, generateNonce, generateRunId } from './ids.js';
export {
  summaryKindOfReportSchema,
  SUMMARY_SCHEMA_ID_PREFIX,
} from './summary-schema.js';
export {
  reportSchemaExtendsFindings,
  FINDINGS_SCHEMA_ID_PREFIX,
} from './findings-schema.js';
export {
  extensionFindingRows,
  findReservedFindingTypes,
  fixerResolutionEntries,
  kernelSafetyRows,
  RESERVED_FINDING_TYPES,
} from './findings-report.js';
export {
  buildReportContract,
  loadSpecSchemaText,
  type IReportContractInput,
} from './report-contract.js';
export {
  buildFindingsSection,
  selectFixerFindings,
  type IFixerFindingProjection,
} from './findings-injection.js';
export {
  InvalidTtlError,
  InvalidPriorityError,
  JobNotRunningError,
  JobRenderError,
} from './errors.js';
