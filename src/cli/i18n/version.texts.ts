/**
 * CLI strings emitted by `sm version` (`cli/commands/version.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const VERSION_TEXTS = {
  /**
   * One row of the human-mode version matrix. Two-space indent matches
   * the sectional rhythm of the rest of the CLI; the key column is
   * dimmed at the call site so the eye lands on the values.
   */
  matrixRow: '  {{key}}  {{value}}\n',
} as const;
