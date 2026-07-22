/**
 * User-facing strings emitted by the `name-mismatch` built-in rule
 * (`plugins/core/analyzers/name-mismatch/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const NAME_MISMATCH_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>`). The shared `formatFinding` helper
   * wraps it with the backtick subject (the declared `frontmatter.name`).
   * The evidence is the diverging path-derived handle; the "answers to
   * both" clause is the why (dual identity in the resolution index).
   */
  message:
    'Declared name differs from the {{sourceLabel}} "{{derivedName}}"; the node answers to ' +
    'both names when references resolve',
  /**
   * Remediation hint (`fix.summary`, not autofixable). Renaming either
   * side settles the identity; the override can also be deliberate
   * (the info-tier kinds document it as legal).
   */
  fixSummary:
    'Rename the file or folder to match the declared name, or align `name` with the path; ' +
    'keep the override if the dual identity is deliberate.',
  /**
   * Human labels for the path-derived identifier sources, interpolated
   * into `message` as `{{sourceLabel}}`.
   */
  sourceLabels: {
    'filename-basename': 'filename stem',
    dirname: 'parent directory name',
  },
} as const;
