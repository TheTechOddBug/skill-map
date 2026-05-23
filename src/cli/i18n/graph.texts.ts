/**
 * CLI strings emitted by `sm graph` (`cli/commands/graph.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const GRAPH_TEXTS = {
  /**
   * §3.1b two-line block. The user asked for a formatter id that no
   * registered plugin / built-in advertises. Hint enumerates the
   * available ids so the operator can re-run.
   */
  noFormatterRegistered:
    '{{glyph}}  No formatter registered for format={{format}}.\n' +
    '   {{hint}}\n',
  noFormatterRegisteredHint: 'Available: {{available}}.',

  availableNone: '(none)',
} as const;
