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
    'invalid --ttl {{value}}: must be a non-negative integer number of seconds (0 disarms the expiry)',
  invalidPriority: 'invalid --priority {{value}}: must be an integer',

  // --- render validation -------------------------------------------------
  renderMissingPlaceholder:
    'action prompt template must reference the {{placeholder}} placeholder that marks where the node body is inserted',
  renderAuthoredDelimiter:
    'action prompt template must not author its own <user-content> delimiter; the kernel owns that block (use the {{placeholder}} placeholder instead)',

  // --- report contract (render prelude) -----------------------------------
  // Kernel-authored section rendered after the extension template and
  // before the `<user-content>` block (`spec/job-lifecycle.md` §Submit
  // step 9). The heading + intro precede one fenced ```json block per
  // schema in the contract chain (extension schema, namespace envelope,
  // report-base), verbatim byte-copies.
  reportContractHeading: '## Report contract',
  reportContractIntro:
    'Your JSON report MUST validate against the first schema below. The ' +
    'blocks after it are the canonical schemas it references via `$ref` ' +
    '(the URLs are identifiers, never fetched).',

  // --- record race guard ---------------------------------------------------
  jobNotRunning:
    'job {{id}} is not in running state (reaped, cancelled, or already recorded); nothing was written',
} as const;
