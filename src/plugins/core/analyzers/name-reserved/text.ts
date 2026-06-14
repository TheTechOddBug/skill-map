/**
 * User-facing strings emitted by the `name-reserved` built-in rule
 * (`plugins/core/analyzers/name-reserved/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const NAME_RESERVED_TEXTS = {
  /**
   * Target-side body (`<what>; <why>`): emitted on the user file that
   * collides with a runtime built-in. The shared `formatFinding` helper
   * adds no subject (the offending node IS the finding's own node); the
   * remediation hint moves to `Issue.fix.summary` below.
   */
  message:
    'Name collision; this {{kind}} name is shadowed by the {{provider}} runtime built-in',
  /** Remediation hint for the target-side finding. */
  fixSummary: 'Rename the file or its frontmatter.name.',
  /**
   * Source-side body (`<what>; <why>`): emitted on the node that
   * AUTHORED a link whose target resolves to a reserved name. Explains
   * WHY the link's confidence dropped to `RESERVED_TARGET_CONFIDENCE`
   * (today `0.1`): the kernel saw the target match a runtime built-in
   * and downgraded the edge so the operator notices. The shared
   * `formatFinding` helper wraps it with the backtick target subject and
   * the `L<line>:` location prefix.
   */
  linkMessage:
    'Name collision; resolves to the {{provider}} built-in ({{reservedKind}} `{{reservedPath}}`), the built-in wins so this edge drops to confidence {{confidence}}',
  /** Remediation hint for the source-side finding. */
  linkFixSummary: 'Rename the target file or its frontmatter.name.',
} as const;
