/**
 * User-facing strings emitted by the `observed-link-missing` built-in
 * analyzer (`plugins/core/analyzers/observed-link-missing/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const OBSERVED_LINK_MISSING_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>`). The shared `formatFinding` helper
   * wraps it with the backtick subject (the observed target); the source
   * node is the finding's own node, so it never appears. `{{noun}}` is
   * the relation noun below (paired keys, the two relations pluralise
   * differently); `{{sessionsPlural}}` rides the `{{plural}}`-slot
   * pattern. Severity is `info` by design: reality commenting on the
   * authored design, never a code defect.
   */
  message:
    'Observed {{count}} {{noun}} across {{sessions}} session{{sessionsPlural}}; no declared link connects this node to the target.',
  /**
   * Remediation hint surfaced via `Issue.fix.summary`. Phrased as a
   * choice: declaring the link resolves it on the next scan, dismissing
   * records the durable sidecar suppression. No auto-fixer exists (user
   * decision: the operator edits the markdown by hand).
   */
  fixSummary:
    'Declare the link in the node body or frontmatter, or dismiss this observation.',
  /** Relation nouns (paired keys: `spawn` pluralises differently than `invocation`). */
  invokesSingular: 'invocation',
  invokesPlural: 'invocations',
  spawnsSingular: 'spawn',
  spawnsPlural: 'spawns',
  readsSingular: 'read',
  readsPlural: 'reads',
} as const;
