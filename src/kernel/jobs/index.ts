/**
 * Barrel for the job-submit kernel helpers (Step 10 Phase A, queue
 * infrastructure). Pure, side-effect-free building blocks the CLI
 * `sm jobs submit` verb composes; the storage writes live in the SQLite
 * adapter (`kernel/adapters/sqlite/jobs.ts`), not here.
 */

export {
  computeContentHash,
  computePromptTemplateHash,
  type IContentHashInput,
} from './content-hash.js';
export { loadCanonicalPreamble } from './preamble.js';
export {
  isNodelessTargetId,
  nodelessTarget,
  nodelessTargetId,
} from './nodeless-target.js';
export {
  renderJobContent,
  wrapUserContent,
  unescapeUserContentClose,
  USER_CONTENT_PLACEHOLDER,
  type IRenderJobContentInput,
} from './render.js';
export {
  isProbabilistic,
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
export { isTagsReportSchema, TAGS_SCHEMA_ID_PREFIX } from './tags-schema.js';
export {
  reportSchemaExtendsFindings,
  FINDINGS_SCHEMA_ID_PREFIX,
} from './findings-schema.js';
export {
  extensionFindingRows,
  findReservedFindingTypes,
  fixerResolutionEntries,
  isFindingSuppressed,
  kernelSafetyRows,
  RESERVED_FINDING_TYPES,
  suppressionsFromAnnotations,
  type ISuppressionEntry,
  type ISuppressionMatch,
} from './findings-report.js';
export {
  buildReportContract,
  loadSpecSchemaText,
  type IReportContractInput,
} from './report-contract.js';
export {
  buildFindingsSection,
  buildIssuesSection,
  selectFixerFindings,
  selectFixerIssues,
  type IFixerFindingProjection,
  type IFixerIssueProjection,
} from './findings-injection.js';
export {
  buildCurrentTagsSection,
  selectCurrentTags,
} from './current-tags-injection.js';
export {
  loadCanonicalSkillTemplate,
  loadSkillActionReportSchema,
  loadSkillActionReportSchemaText,
} from './skill-template.js';
export { buildSkillSection, type ISkillSectionInput } from './skill-injection.js';
export {
  bucketFilterActive,
  countDismissedHidden,
  countFixedHidden,
  isFindingShown,
  partitionFindingsView,
  type IFindingsBucketFlags,
  type IFindingsViewPartition,
  type TFindingSuppressedTest,
} from './findings-view.js';
export {
  InvalidTtlError,
  InvalidPriorityError,
  JobNotRunningError,
  JobRenderError,
} from './errors.js';
export { toPublicJob, type PublicJob } from './public-job.js';
