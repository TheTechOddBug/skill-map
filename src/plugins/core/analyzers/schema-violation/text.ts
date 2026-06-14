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

  /** `Missing required frontmatter; <missing>` */
  frontmatterBaseFailure: 'Missing required frontmatter; {{missing}}',

  /** Singular tooltip on the alert / chip when a node has exactly one validation failure. */
  alertTooltipSingle: 'Frontmatter or schema validation failed.',
  /** Plural tooltip; `{{count}}` capped at 99 in the chip badge but the tooltip text shows the raw count. */
  alertTooltipMany: '{{count}} schema validation issues on this node.',
} as const;
