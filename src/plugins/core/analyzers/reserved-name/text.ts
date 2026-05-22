/**
 * User-facing strings emitted by the `reserved-name` built-in rule
 * (`plugins/core/analyzers/reserved-name/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const RESERVED_NAME_TEXTS = {
  /**
   * `<path> shadows a built-in <provider> <kind>. The runtime ignores
   * this file in favour of its own built-in. Rename the file or
   * `frontmatter.name` to a non-reserved value.`
   */
  message:
    '{{path}} shadows a built-in {{provider}} {{kind}}. The runtime ignores this file in favour of its own built-in. Rename the file or `frontmatter.name` to a non-reserved value.',
} as const;
