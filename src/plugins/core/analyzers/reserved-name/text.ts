/**
 * User-facing strings emitted by the `reserved-name` built-in rule
 * (`plugins/core/analyzers/reserved-name/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const RESERVED_NAME_TEXTS = {
  /**
   * Target-side message: emitted on the user file that collides with
   * a runtime built-in. Same wording skill-map shipped before the
   * source-side link finding landed.
   */
  message:
    '{{path}} shadows a built-in {{provider}} {{kind}}. The runtime ignores this file in favour of its own built-in. Rename the file or `frontmatter.name` to a non-reserved value.',
  /**
   * Source-side message: emitted on the node that AUTHORED a link
   * whose target resolves to a reserved name. Explains WHY the link's
   * confidence dropped to `RESERVED_TARGET_CONFIDENCE` (today `0.1`):
   * the kernel saw the target match a runtime built-in and downgraded
   * the edge so the operator notices.
   */
  linkMessage:
    'Link `{{kind}} {{target}}` resolves to a name reserved by the {{provider}} runtime ({{reservedKind}} `{{reservedPath}}`). The runtime shadows the user file, so this edge is downgraded to confidence {{confidence}} instead of 1.0. Rename the target file or its `frontmatter.name` to a non-reserved value.',
} as const;
