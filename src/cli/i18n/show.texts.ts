/**
 * Strings emitted by `cli/commands/show.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const SHOW_TEXTS = {
  nodeNotFound: 'Node not found: {{nodePath}}\n',

  // --- header ----------------------------------------------------------
  /**
   * Single-line node header:
   *   `  ✓  <path>   <kind>   provider: <provider>`
   * The glyph is wrapped in green at the call site (✓ = node found).
   * The provider tail is dim and elided when it equals the kind label
   * (`provider: markdown` next to `kind=markdown` is pure noise).
   */
  nodeHeader: '  {{glyph}}  {{path}}   {{kind}}{{providerSuffix}}\n',
  /** Tail appended to `nodeHeader` when provider differs from kind. */
  providerSuffix: '   {{label}}',
  providerSuffixLabel: 'provider: {{provider}}',

  // --- field block (Title / Description / Tokens / …) -----------------
  /** Field row, label padded by the renderer to align values. */
  fieldRow: '  {{label}}  {{value}}\n',
  /** Continuation indent for multi-line values (description, etc.). */
  fieldContinuation: '  {{indent}}{{value}}\n',
  fieldLabelTitle: 'Title',
  fieldLabelDescription: 'Description',
  fieldLabelStability: 'Stability',
  fieldLabelVersion: 'Version',
  fieldLabelTokens: 'Tokens',
  fieldLabelExternalRefs: 'External refs',
  /** `{{total}} total · {{frontmatter}} frontmatter · {{body}} body`. */
  weightSplit: '{{total}} total · {{frontmatter}} frontmatter · {{body}} body',

  // --- frontmatter section ---------------------------------------------
  frontmatterSection: '\n  Frontmatter\n',

  // --- links sections --------------------------------------------------
  linksOutSection: '\n  Links out ({{count}})\n',
  linksInSection: '\n  Links in ({{count}})\n',
  /**
   * One link row inside a section. Arrow + kind + confidence + endpoint
   * are column-aligned at the call site. Confidence column is dim.
   * `{{dup}}` carries the optional `(×N)` count for grouped rows.
   */
  linkRow: '    {{arrow}}  {{kind}}  {{confidence}}  {{endpoint}}{{dup}}\n',
  linkDup: '  (×{{count}})',

  // --- issues section --------------------------------------------------
  issuesSection: '\n  Issues ({{count}})\n',
  /** Issue row, mirrors the `sm check` format. */
  issueRow: '    {{glyph}}  {{analyzerId}}   {{message}}\n',
} as const;
