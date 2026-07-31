/**
 * Strings emitted by `cli/commands/export.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const EXPORT_TEXTS = {
  /**
   * Generic §3.1 single-line error wrapper. The caller passes the
   * already-rendered glyph (red `✕`) and the inner error message. No
   * hint here because the inner message itself varies across call
   * sites (config load, file write, malformed query). Specific errors
   * with actionable next steps use their own §3.1b blocks below.
   */
  errorPrefix: '{{glyph}}  sm export: {{message}}\n',

  /**
   * §3.1b error block emitted when the operator asks for a format
   * outside the closed catalogue. Hint lists the supported ids.
   */
  formatUnsupported:
    '{{glyph}}  sm export: unsupported format "{{format}}".\n' +
    '   {{hint}}\n',
  formatUnsupportedHint: 'Supported: {{supported}}.',

  /**
   * §3.1b error block emitted when `--format mermaid` is asked for but
   * the built-in formatter backing it is turned off. Mirrors the
   * `sm bump` refusal: a disabled extension must not work through ANY
   * surface, the verb that wraps it included.
   */
  formatterDisabled:
    '{{glyph}}  sm export: format "{{format}}" needs the {{extension}} extension, which is disabled.\n' +
    '   {{hint}}\n',
  formatterDisabledHint: 'Enable it with `sm plugins enable {{extension}}`, or export with --format json or md.',

  // --- markdown body ---------------------------------------------------------
  /** Top-level heading for the markdown export. */
  mdTitle: '# skill-map export',
  /** Echo of the user's query string (or the empty placeholder). */
  mdQueryLine: 'Query: `{{query}}`',
  /** Placeholder used when the user's query is empty. */
  mdQueryEmpty: '(empty, all nodes)',
  /** Counts summary line under the query. */
  mdCounts:
    'Counts: {{nodes}} nodes, {{links}} links, {{issues}} issues.',

  /** Section header for a single node-kind group. */
  mdKindSectionHeader: '## {{kind}} ({{count}})',

  /** Bullet template for a node row. `{{title}}` and `{{issues}}` are pre-rendered (empty when absent). */
  mdNodeBullet: '- `{{path}}`{{title}}{{issues}}',
  /** `: "<title>"` segment when the node has a title. */
  mdNodeTitleSuffix: ': "{{title}}"',
  /** ` (N issue(s))` segment when the node has any associated issues. */
  mdNodeIssueSuffix: ' ({{count}} {{label}})',
  mdNodeIssueLabelSingular: 'issue',
  mdNodeIssueLabelPlural: 'issues',

  /** Section header for the links block. */
  mdLinksSectionHeader: '## links ({{count}})',
  /** Bullet template for one link row. */
  mdLinkBullet:
    '- `{{source}}` --{{kind}}--> `{{target}}` _[{{confidence}}]_',

  /** Section header for the issues block. */
  mdIssuesSectionHeader: '## issues ({{count}})',
  /** Bullet template for one issue row. */
  mdIssueBullet:
    '- **[{{severity}}]** `{{analyzerId}}`: {{message}}',
} as const;
