/**
 * User-facing strings emitted by the `validate-all` built-in rule
 * (`built-in-plugins/analyzers/validate-all/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const VALIDATE_ALL_TEXTS = {
  /** `Node <path> failed schema validation: <errors>` */
  nodeFailure: 'Node {{path}} failed schema validation: {{errors}}',

  /** `Link <source> → <target> failed schema validation: <errors>` */
  linkFailure: 'Link {{source}} → {{target}} failed schema validation: {{errors}}',

  /** `Node <path> is missing required frontmatter fields: <missing>` */
  frontmatterBaseFailure: 'Node {{path}} is missing required frontmatter fields: {{missing}}.',

  /** Singular tooltip on the alert / chip when a node has exactly one validation failure. */
  alertTooltipSingle: 'Frontmatter or schema validation failed.',
  /** Plural tooltip; `{{count}}` capped at 99 in the chip badge but the tooltip text shows the raw count. */
  alertTooltipMany: '{{count}} schema validation issues on this node.',
} as const;
