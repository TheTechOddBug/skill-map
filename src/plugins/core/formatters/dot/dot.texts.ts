/**
 * User-facing strings emitted by the `dot` built-in formatter
 * (`plugins/core/formatters/dot/index.ts`). Produces the
 * `sm graph --format dot` output.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * The templates carry DOT SYNTAX, not prose: the quotes around every id
 * and label, the `->` arrow, the bracketed attribute list, and the
 * trailing semicolons are load-bearing. Reword the comment line freely;
 * changing the punctuation around a placeholder changes the grammar.
 */

export const DOT_FORMATTER_TEXTS = {
  /** Graph header. The name is quoted so the hyphen is never a token. */
  open: 'digraph "skill-map" {',

  /** Graph footer. */
  close: '}',

  /** `//` line comment carrying the graph counts. */
  headerComment: '  // skill-map graph: {{nodes}} nodes, {{links}} links, {{issues}} issues',

  /**
   * The single graph-level attribute the formatter sets: left-to-right
   * rank direction, matching the `mermaid` formatter's orientation so
   * the two renderings of one graph read the same way.
   */
  rankDir: '  rankdir="LR";',

  /** Node statement. Id and label are both the (escaped) node path. */
  node: '  "{{id}}" [label="{{label}}"];',

  /** Edge statement. The link kind rides in the edge label. */
  edge: '  "{{source}}" -> "{{target}}" [label="{{kind}}"];',
} as const;
