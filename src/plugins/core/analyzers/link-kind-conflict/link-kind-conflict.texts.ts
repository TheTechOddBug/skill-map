/**
 * User-facing strings emitted by the `link-kind-conflict` built-in rule
 * (`plugins/core/analyzers/link-kind-conflict/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const LINK_KIND_CONFLICT_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>`). The shared `formatFinding` helper
   * wraps it with the backtick subject (the disputed target); the source
   * is the finding's own node, so it never appears in the message.
   */
  message: 'Conflicting link kind; detectors disagree ({{kindList}})',
  /**
   * Remediation hint surfaced via `Issue.fix.summary`. Not autofixable:
   * the rule cannot tell which kind the author meant, so it offers the
   * two valid resolutions (drop one source, or accept the overlap on
   * purpose). Mirrors the `warn`-severity `link-self-loop` hint shape.
   */
  fixSummary: 'Remove one of the conflicting sources to settle on a single kind, or ignore the conflict deliberately.',
} as const;
