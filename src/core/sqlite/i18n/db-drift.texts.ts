/**
 * Strings for the pre-1.0 schema-drift rebuild
 * (`core/sqlite/db-drift-reset.ts`). When a write-side open (`sm scan`,
 * `sm watch`, the BFF watcher) finds the on-disk DB was written by a
 * different `major.minor` than the running CLI, the cache is rebuilt
 * from scratch instead of migrated (the DB is derived; `.sm` sidecars
 * are the source of truth). See `spec/db-schema.md` §Schema drift
 * (pre-1.0).
 *
 * Follows `context/cli-output-style.md` §3.1b: `{{glyph}}` + headline,
 * dim hint on the next line (indent 3), with a sibling `<key>Hint`
 * string so the seam renders the dim wrapper from the caller-supplied
 * colour resolver.
 *
 * Lives beside `db-version.texts.ts` because both catalogs are owned by
 * the version-skew machinery the CLI and BFF share through
 * `core/sqlite/`.
 */

export const DB_DRIFT_TEXTS = {
  // Interactive confirm (TTY `sm scan`, no `--yes`). The block is
  // written to stderr, then the question line drives `readline`.
  // `{{reason}}` is one of the `driftReason*` strings below so the
  // operator sees WHY the cache is being rebuilt (version skew vs an
  // inline schema change the version did not bump).
  driftPrompt:
    '{{glyph}}  Local cache is from skill-map {{dbVersion}}, you are on {{currentVersion}} ({{reason}}).\n' +
    '   {{hint}}\n',
  driftPromptHint:
    'It will be rebuilt from your .sm files on this scan; nothing of yours is touched.',
  driftPromptQuestion: 'Rebuild the local cache now? [y/N] ',

  // Receipt after the rebuild (printed by the scan / refresh path).
  driftReset:
    '{{glyph}}  Local cache rebuilt: was from skill-map {{dbVersion}}, you are on {{currentVersion}}.\n' +
    '   {{hint}}\n',
  driftResetHint:
    'Rebuilt from your .sm files; nothing of yours was touched.',

  // Abort headline when the operator declines (wrapped by the caller's
  // `sm scan: {message}` shell, so it carries no glyph / verb prefix).
  driftAborted:
    'cache rebuild declined: the {{dbVersion}} cache cannot be reused on {{currentVersion}} ({{reason}}). {{hint}}',
  driftAbortedHint:
    'Re-run with --yes, or run `sm db reset --hard` then `sm scan`.',

  // Drift reason fragments, interpolated as `{{reason}}` above. Version
  // skew = the recorded scanned_by_version differs at major.minor.
  // Schema fingerprint = an inline migration edit (no version bump,
  // greenfield posture) changed the DDL.
  driftReasonVersion: 'version skew',
  driftReasonSchema: 'schema change in this version',
} as const;
