/**
 * User-facing strings emitted by the `annotation-orphan` built-in rule
 * (`plugins/core/analyzers/annotation-orphan/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ANNOTATION_ORPHAN_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>`). The shared `formatFinding` helper
   * wraps it with the backtick subject (the orphan sidecar file); the
   * expected markdown path IS the finding's `nodeIds[0]`, so it never
   * appears in the message. The remediation hint moves to
   * `Issue.fix.summary` below.
   */
  message: 'Orphan sidecar; no matching markdown node',
  /** Remediation hint surfaced via `Issue.fix.summary`. */
  fixSummary: 'Run `sm sidecar prune` to remove orphan sidecars.',
} as const;
