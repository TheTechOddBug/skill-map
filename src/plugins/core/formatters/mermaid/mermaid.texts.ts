/**
 * User-facing strings emitted by the `mermaid` built-in formatter
 * (`plugins/core/formatters/mermaid/index.ts`). Produces the
 * `sm graph --format mermaid` / `sm export --format mermaid` output.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * The templates carry Mermaid SYNTAX, not prose: the quotes around
 * `{{label}}`, the `-->|"..."|` arrow, and the trailing semicolons are
 * load-bearing. Reword the human parts (the comment lines) freely;
 * changing the punctuation around a placeholder changes the grammar.
 */

export const MERMAID_FORMATTER_TEXTS = {
  /**
   * Diagram declaration. MUST be the first line: Mermaid detects the
   * diagram type from it. `LR` (left to right) is the chosen direction,
   * see the formatter docblock for why.
   */
  declaration: 'flowchart LR',

  /**
   * `%%` comment carrying the graph counts. Emitted at column 0 because
   * the Mermaid docs describe a comment as "a new line starting with
   * `%%`". Curly braces are deliberately absent: Mermaid's own
   * documentation warns they read as directive syntax inside a comment.
   */
  headerComment: '%% skill-map graph: {{nodes}} nodes, {{links}} links, {{issues}} issues',

  /**
   * Second `%%` comment, emitted only when the graph has no nodes and
   * no links, so the document says why it renders blank instead of
   * looking truncated.
   */
  emptyComment: '%% no nodes to render; run `sm scan` to populate the graph',

  /** Node statement: a synthetic id plus the real path as a quoted label. */
  node: '  {{id}}["{{label}}"]',

  /** Edge statement. The link kind rides in a quoted arrow label. */
  edge: '  {{source}} -->|"{{kind}}"| {{target}}',

  /** Per-kind style definition. Only kinds present in the graph get one. */
  classDef: '  classDef {{name}} {{style}};',

  /**
   * Class assignment, ONE node per statement. The comma-separated
   * multi-node form (`class n0,n1 name;`) is widely used but is not in
   * the documented examples, so the formatter sticks to the form the
   * Mermaid docs actually show.
   */
  classAssign: '  class {{id}} {{name}};',
} as const;
