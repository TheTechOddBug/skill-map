/**
 * Strings emitted by the kernel job-submit helpers (`kernel/jobs/*`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation (single
 * pass, so a `{{placeholder}}` var whose VALUE is itself `{{userContent}}`
 * is emitted verbatim and never re-scanned).
 *
 * English-only catalog (externalized, not internationalized) per the
 * project i18n stance. CLI-facing job strings live in
 * `cli/i18n/jobs.texts.ts`; these are the kernel-side render / resolve
 * error messages surfaced through typed errors.
 */

export const JOB_TEXTS = {
  // --- TTL / priority resolution -----------------------------------------
  invalidTtl:
    'invalid --ttl {{value}}: must be a positive integer number of seconds',
  invalidPriority: 'invalid --priority {{value}}: must be an integer',

  // --- render validation -------------------------------------------------
  renderMissingPlaceholder:
    'action prompt template must reference the {{placeholder}} placeholder that marks where the node body is inserted',
  renderAuthoredDelimiter:
    'action prompt template must not author its own <user-content> delimiter; the kernel owns that block (use the {{placeholder}} placeholder instead)',
} as const;
