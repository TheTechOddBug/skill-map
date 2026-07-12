/**
 * Strings emitted by the DB version-skew detector
 * (`core/sqlite/db-version-check.ts` + `with-sqlite.ts`). Surfaces when
 * an `sm` binary opens a DB that was last written by a different
 * skill-map version, the link-matrix walkthrough on 2026-05-23
 * surfaced the problem: an older global CLI tried to read a newer DB
 * and crashed with `Invalid Confidence value 0.5` instead of a useful
 * hint.
 *
 * Follows `context/cli-output-style.md` §3.1b for error blocks:
 * `{{glyph}}` + headline + dim hint on the next line (indent 3), with
 * sibling `<key>Hint` strings for the secondary line so the seam can
 * render the dim wrapper from the caller-supplied colour resolver.
 *
 * Severity mapping:
 *   - `dbVersionTooNew*`, ERROR, `✕` red, refuses to open.
 *   - `dbVersionMajorMismatch*`, ERROR, `✕` red, refuses to open.
 *   - `dbVersionOlder*`, WARN, `⚠` yellow, open continues.
 *
 * The defensive fall-through for enum-parse failures that escape the
 * meta check (no `scan_meta` row but the DB still carries malformed
 * values) lives in the kernel storage catalog at
 * `src/kernel/i18n/storage.texts.ts:scanLoadDbVersionLoadWrapped`; the
 * wrap itself fires inside `kernel/adapters/sqlite/scan-load.ts`.
 *
 * Lives under `core/sqlite/i18n/` because both the CLI and the BFF
 * consume the version-checked open path; placing the catalog beside
 * the seam keeps the catalog reachable from either side without
 * crossing a workspace boundary.
 */

export const DB_VERSION_TEXTS = {
  dbVersionTooNew:
    '{{glyph}}  This DB was written by a newer skill-map ({{dbVersion}}, you have {{currentVersion}}).\n' +
    '   {{hint}}\n',
  dbVersionTooNewHint:
    'Upgrade the CLI (`pnpm i -g @skill-map/cli@latest`, or the equivalent for your global package manager) and re-run.',

  dbVersionMajorMismatch:
    '{{glyph}}  This DB was written by skill-map {{dbVersion}}; the CLI you are running ({{currentVersion}}) is on a different major series.\n' +
    '   {{hint}}\n',
  dbVersionMajorMismatchHint:
    'Delete the `.skill-map/` directory and re-scan, or revert to a CLI in the {{dbMajor}}.x series.',

  dbVersionOlder:
    '{{glyph}}  This DB was last written by an older skill-map ({{dbVersion}}, you have {{currentVersion}}).\n' +
    '   {{hint}}\n',
  dbVersionOlderHint:
    'Behaviour may differ until the next `sm scan` rewrites the metadata; downstream parse errors are likely a symptom of this skew.',

  // Schema-fingerprint drift on a same-version DB (pre-1.0 greenfield:
  // a column was added inline to a migration with no version bump, so
  // the version axis reads as compatible but the on-disk schema is
  // older). WARN, `⚠` yellow, the read continues but a query may hit a
  // missing column. Has no `dbVersion` placeholder, the version matched.
  dbSchemaDrift:
    '{{glyph}}  This DB predates a schema change in skill-map {{currentVersion}} (same version, older columns).\n' +
    '   {{hint}}\n',
  dbSchemaDriftHint:
    'Run `sm scan` to rebuild the local cache (your .sm sidecars are untouched), or `sm db reset`; some columns may be missing until then.',

  // Write-side refusal, the DEFAULT for a DB-mutating open that does NOT
  // own drift (job verbs, `plugins enable`, `config set`, `record`, ...).
  // Unlike the read-side WARN above, a write CANNOT continue against an
  // older on-disk schema without the cryptic `CHECK constraint failed` /
  // `no such column` crash, so the seam REFUSES with a `DbSchemaDriftError`
  // instead. ERROR, `✕` red, §3.1b block for the CLI stderr. Same-version
  // (fingerprint) drift only, a pure version bump with no schema change
  // keeps the fingerprint stable and never trips this.
  dbSchemaDriftWrite:
    '{{glyph}}  This DB predates a schema change in skill-map {{currentVersion}} and cannot be written safely (same version, older columns).\n' +
    '   {{hint}}\n',
  dbSchemaDriftWriteHint:
    'Run `sm db reset --hard` then `sm scan` to rebuild the local cache; your .sm sidecars are untouched.',
  // Plain, glyph-free variant carried on `DbSchemaDriftError.message` so
  // the BFF error envelope (and any non-TTY consumer) surfaces a single
  // clean sentence instead of the §3.1b block above.
  dbSchemaDriftWritePlain:
    'This DB predates a schema change in skill-map {{currentVersion}} and cannot be written safely. Run `sm db reset --hard` then `sm scan` to rebuild the local cache; your .sm sidecars are untouched.',

  // The defensive wrapper for `parseConfidence` / `parseLinkKind` /
  // `parseSeverity` failures during `loadScanResult` (when the meta
  // row was wiped and the version check returned `no-meta`) lives in
  // the kernel storage catalog at
  // `src/kernel/i18n/storage.texts.ts:scanLoadDbVersionLoadWrapped`.
  // The wrap fires inside `kernel/adapters/sqlite/scan-load.ts`, so
  // the message stays inside the kernel boundary; this catalog only
  // owns the human-mode §3.1b blocks the version-check seam itself
  // renders.
} as const;
