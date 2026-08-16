/**
 * User-facing strings emitted by the `declared-link-unobserved` built-in
 * analyzer (`plugins/core/analyzers/declared-link-unobserved/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const DECLARED_LINK_UNOBSERVED_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>`). The shared `formatFinding` helper
   * wraps it with the backtick subject (the declared target); the source
   * node is the finding's own node, so it never appears. `{{runs}}` /
   * `{{sessions}}` are the volume-gate evidence: the claim is only made
   * because the source demonstrably ran without this link ever firing.
   * Severity is `info` by design: reality questioning the authored
   * design, never a code defect.
   */
  message:
    'Declared but never observed: this node ran {{runs}} time{{runsPlural}} across {{sessions}} recorded session{{sessionsPlural}} without using this link.',
  /**
   * Remediation hint surfaced via `Issue.fix.summary`. Phrased as a
   * choice: reworking or removing the stale declaration resolves it on
   * the next scan, dismissing records the durable sidecar suppression
   * (the link is kept deliberately). No auto-fixer exists (same user
   * decision as the missing direction: design edits are by hand).
   */
  fixSummary:
    'Remove or rework the stale link, or dismiss to keep it deliberately.',
} as const;
