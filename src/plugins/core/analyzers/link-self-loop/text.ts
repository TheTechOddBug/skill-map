/**
 * User-facing strings emitted by the `link-self-loop` built-in rule
 * (`plugins/core/analyzers/link-self-loop/index.ts`).
 *
 * Convention: the analyzer owns only the `<what>; <why>` diagnosis body;
 * the shared `formatFinding` helper (`kernel/util/finding-format.ts`)
 * wraps it with the backtick subject line and the `L<line>:` location
 * prefix. The `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const LINK_SELF_LOOP_TEXTS = {
  /**
   * Per-edge warn body: a node body references itself via the slash /
   * at-directive / markdown-link surface (most commonly because the
   * file's heading IS the invocation token, e.g. `# /deploy` inside
   * `commands/deploy.md`). The link is structurally valid but rarely
   * the operator's intent; UI consumers MAY hide it by default and
   * surface a count.
   */
  message: 'Self-reference; the skill/command invokes itself, potential loop',
  /**
   * Remediation hint surfaced via `Issue.fix.summary` (the Inspector
   * renders it under the finding, separate from the diagnosis body).
   */
  fixSummary: 'Remove the token or ignore the self-reference deliberately.',
} as const;
