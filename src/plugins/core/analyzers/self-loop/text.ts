/**
 * User-facing strings emitted by the `self-loop` built-in rule
 * (`plugins/core/analyzers/self-loop/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const SELF_LOOP_TEXTS = {
  /**
   * Per-edge warn: a node body references itself via the slash /
   * at-directive / markdown-link surface (most commonly because the
   * file's heading IS the invocation token, e.g. `# /deploy` inside
   * `commands/deploy.md`). The link is structurally valid but rarely
   * the operator's intent; UI consumers MAY hide it by default and
   * surface a count.
   */
  message:
    '{{source}} references itself via `{{trigger}}` ({{kind}}). Self-loops typically come from the file\'s own heading or label and are noise rather than intent. Either remove the in-body token or treat this finding as expected and acknowledged.',
} as const;
