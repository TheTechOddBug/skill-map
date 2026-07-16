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

  // --- findings section --------------------------------------------------
  findingsSection: '\n  Findings ({{count}})\n',
  /**
   * One stored per-node finding: severity glyph (mirrors the issues
   * section), dim extension id, the type slug, the finder's message, and
   * an optional yellow `(stale)` marker when the node body changed since
   * the judgment was recorded.
   */
  findingRow: '    {{glyph}}  {{extensionId}}  {{type}}  {{message}}{{modelSuffix}}{{staleSuffix}}\n',
  /**
   * Suffix (dim) carrying the recording agent's self-reported model when
   * one was declared (`sm record --model`).
   */
  findingModelSuffix: '  ({{model}})',
  /** Marker appended (yellow) when the finding is stale. */
  findingStale: '  (stale)',
  /**
   * Optional line under a finding row: the lifecycle STATE a FIXER moved
   * it into (`spec/db-schema.md` §state_findings). Same shape and wording
   * as `sm findings` (see `findings.texts.ts`), so the two read alike.
   */
  findingResolutionLine: '       {{glyph}}  {{text}}\n',
  /**
   * `fixed`: green `✓` + dim text. A handled state, not a verdict: only
   * the finder re-judging confirms the defect is gone (never "resolved" /
   * "verified").
   */
  findingResolutionFixed: 'fixed by {{fixer}}: {{note}}',
  /**
   * `declined`: yellow `⚠` + undimmed text. The author's TODO, the
   * higher-value state of the two.
   */
  findingResolutionDeclined: '{{fixer}} declined, needs your decision: {{note}}',

  // --- summary section -------------------------------------------------
  summarySection: '\n  Summary ({{count}})\n',
  /**
   * One stored per-node summary: dim summarizer action id, the report
   * headline, and an optional `(stale)` marker when the node body changed
   * since the summary was generated.
   */
  summaryRow: '    {{actionId}}   {{headline}}{{modelSuffix}}{{staleSuffix}}\n',
  /**
   * Suffix (dim) carrying the recording agent's self-reported model when
   * one was declared (`sm record --model`).
   */
  summaryModelSuffix: '  ({{model}})',
  /** Marker appended (yellow) when the summary is stale. */
  summaryStale: '  (stale)',
  /** Fallback when the report carries no recognised headline field. */
  summaryNoHeadline: '(no summary text)',
} as const;
