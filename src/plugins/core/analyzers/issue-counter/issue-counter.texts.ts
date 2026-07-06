/**
 * User-facing strings for the `issue-counter` built-in analyzer
 * (`plugins/core/analyzers/issue-counter/index.ts`). The analyzer
 * itself emits zero issues, only chip contributions, so the catalog
 * is tooltip-only.
 */

export const ISSUE_COUNTER_TEXTS = {
  errorTooltipSingle: '1 error',
  errorTooltipMany: '{{count}} errors',
  warnTooltipSingle: '1 warning',
  warnTooltipMany: '{{count}} warnings',
} as const;
