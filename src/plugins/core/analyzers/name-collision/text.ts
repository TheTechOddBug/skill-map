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
} as const;
