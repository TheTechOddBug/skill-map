/**
 * User-facing strings emitted by the `name-reserved` built-in rule
 * (`plugins/core/analyzers/name-reserved/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const NAME_RESERVED_TEXTS = {
  /**
   * Target-side message: emitted on the user file that collides with
   * a runtime built-in. Same wording skill-map shipped before the
   * source-side link finding landed.
   */
  message:
    'Name collision: this {{kind}} name is already used by the {{provider}} runtime built-in, which shadows this file. Rename the file or its `frontmatter.name`.',
  /**
   * Source-side message: emitted on the node that AUTHORED a link
   * whose target resolves to a reserved name. Explains WHY the link's
   * confidence dropped to `RESERVED_TARGET_CONFIDENCE` (today `0.1`):
   * the kernel saw the target match a runtime built-in and downgraded
   * the edge so the operator notices.
   */
  linkMessage:
    '{{target}}:\nName collision: resolves to a {{provider}} built-in ({{reservedKind}} `{{reservedPath}}`){{where}}; the built-in wins, so this edge drops to confidence {{confidence}}. Rename the target file or its `frontmatter.name`.',
  /** Location suffix after the built-in parens, one detection site. */
  whereSingle: ' (line {{lines}})',
  /** Location suffix after the built-in parens, several detection sites. */
  wherePlural: ' (lines {{lines}})',
} as const;
