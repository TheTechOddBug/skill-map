/**
 * User-facing strings emitted by the `observed-node-dead` built-in
 * analyzer (`plugins/core/analyzers/observed-node-dead/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const OBSERVED_NODE_DEAD_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>`). The shared `formatFinding` helper
   * wraps it with the backtick subject (the node's own path).
   * `{{sessions}}` is the ACTIVE-session denominator: the claim is only
   * made because plenty of recorded activity happened around the node
   * without it ever running. Severity is `info` by design: reality
   * questioning the authored design, never a code defect.
   */
  message:
    'Never observed executing: {{sessions}} recorded sessions of activity and this node never ran.',
  /**
   * Remediation hint surfaced via `Issue.fix.summary`. Phrased as a
   * choice: reworking or retiring the unit resolves it on the next
   * scan, dismissing records the durable sidecar suppression (the node
   * is kept deliberately). No auto-fixer exists.
   */
  fixSummary:
    'Rework or retire the unit, or dismiss to keep it deliberately.',
} as const;
