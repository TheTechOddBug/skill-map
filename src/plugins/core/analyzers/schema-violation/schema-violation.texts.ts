/**
 * User-facing strings emitted by the `schema-violation` built-in rule
 * (`plugins/core/analyzers/schema-violation/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const SCHEMA_VIOLATION_TEXTS = {
  // Diagnosis bodies (`<what>; <why>`). The shared `formatFinding` helper
  // owns the subject / location chrome: the node + frontmatter findings
  // carry no subject (the affected node IS the finding's own node), the
  // link finding uses the link target as its subject.
  /** `Schema validation failed; <errors>` */
  nodeFailure: 'Schema validation failed; {{errors}}',

  /** `<target>` subject + `Link failed schema validation; <errors>` */
  linkFailure: 'Link failed schema validation; {{errors}}',

  /**
   * Remediation hint (`fix.summary`, not autofixable), shared by the
   * node and link findings: the AJV message already names each
   * offending field, so the hint points at correcting those.
   */
  fixSummary:
    'Correct the fields the message lists so the record satisfies its schema; the error names each offending path.',
} as const;
