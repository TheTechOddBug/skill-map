/**
 * User-facing strings emitted by the `name-collision` built-in rule
 * (`plugins/core/analyzers/name-collision/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const NAME_COLLISION_TEXTS = {
  /**
   * Diagnosis body (`<what>; <why>: <evidence>`). The shared
   * `formatFinding` helper wraps it with the backtick subject (the
   * normalised name claimed by two or more nodes). The evidence is the
   * competing node paths.
   */
  message: 'Name collision; {{count}} nodes declare the same name: {{paths}}',
  /**
   * Warn-tier body for a MIXED bucket: a declared `frontmatter.name`
   * collides with another node's filename / dirname handle. Resolution
   * picks a deterministic winner, but the shadowing is authored.
   */
  messageShadow:
    'Name shadowing; a declared name matches the file-derived handle of another node ' +
    '({{count}} claimants): {{paths}}',
} as const;
