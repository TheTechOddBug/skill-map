/**
 * User-facing strings emitted by the `link-self-loop` built-in rule
 * (`plugins/core/analyzers/link-self-loop/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const LINK_SELF_LOOP_TEXTS = {
  /**
   * Per-edge warn: a node body references itself via the slash /
   * at-directive / markdown-link surface (most commonly because the
   * file's heading IS the invocation token, e.g. `# /deploy` inside
   * `commands/deploy.md`). The link is structurally valid but rarely
   * the operator's intent; UI consumers MAY hide it by default and
   * surface a count.
   */
  message:
    '`{{trigger}}`:\nSelf-reference ({{kind}}{{where}}); typically the file\'s own heading or label. Remove the token or ignore deliberately.',
  /** Location suffix inside the kind parens, one detection site. */
  whereSingle: ', line {{lines}}',
  /** Location suffix inside the kind parens, several detection sites. */
  wherePlural: ', lines {{lines}}',
} as const;
