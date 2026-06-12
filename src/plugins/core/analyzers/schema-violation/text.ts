/**
 * User-facing strings emitted by the `schema-violation` built-in rule
 * (`plugins/core/analyzers/schema-violation/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const SCHEMA_VIOLATION_TEXTS = {
  // Compact finding grammar: the affected node (or the link's source)
  // is the finding's own node, so its path never appears.
  /** `Schema validation failed: <errors>` */
  nodeFailure: 'Schema validation failed: {{errors}}',

  /** `<target>:\nLink failed schema validation: <errors>` */
  linkFailure: '{{target}}:\nLink failed schema validation: {{errors}}',

  /** `Missing required frontmatter: <missing>.` */
  frontmatterBaseFailure: 'Missing required frontmatter: {{missing}}.',

  /** Singular tooltip on the alert / chip when a node has exactly one validation failure. */
  alertTooltipSingle: 'Frontmatter or schema validation failed.',
  /** Plural tooltip; `{{count}}` capped at 99 in the chip badge but the tooltip text shows the raw count. */
  alertTooltipMany: '{{count}} schema validation issues on this node.',
} as const;
