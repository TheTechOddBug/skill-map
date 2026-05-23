---
"@skill-map/cli": minor
---

DB version-skew detection. When the local `.skill-map/` SQLite DB was written by a different `@skill-map/cli` version than the one currently running, the operator used to get either silent corruption (older CLI reading a newer DB) or a cryptic "Invalid LinkKind value ..." from the enum parsers downstream. This changeset adds an opt-in classification seam at the SQLite open path so the skew surfaces at open time with a recovery hint, before the kernel touches the rows.

**New seam, `core/sqlite/`.** `src/core/sqlite/with-sqlite.ts` (and its `tryWithSqlite` sibling) gain an optional `versionCheck` opts bag. When the caller passes it, the helper reads `scan_meta.scanned_by_version` right after `adapter.init()` and classifies the skew against the current CLI version. Outcomes:

- `ok`, runtime version equals the stored version, silent.
- `no-meta`, no `scan_meta` row yet (fresh DB or wiped table), silent.
- `warn-older`, DB was written by an OLDER same-major minor. One-shot soft warn (dedup keyed on `dbPath` so multiple seam calls inside a single verb don't double-print); open proceeds, the next `sm scan` rewrites the metadata.
- `error-newer`, DB was written by a NEWER same-major minor. Refuses to open, throws `DbVersionMismatchError`.
- `error-major`, DB was written by a DIFFERENT major. Refuses to open, throws `DbVersionMismatchError`.

**Split classifier / renderer.** Pure logic in `src/core/sqlite/db-version-check.ts` (DB lookup + `classifySkew` against the runtime `VERSION`). Render seam in `src/core/sqlite/db-version-runner.ts` (renders each outcome via `tx`, throws on the two error classifications, dedups the warn). Colour resolution stays at the CLI seam via the `style` opts bag, mirroring `bootstrapActiveProvider`, so `core/sqlite/` reads zero `process.env` (kernel-boundary lint analyzer preserved).

**Strings catalog.** `src/core/sqlite/i18n/db-version.texts.ts` follows `context/cli-output-style.md` §3.1b: two-line block, `✕` / `⚠` glyph + headline + dim hint sourced from sibling `<key>Hint` entries. The strings interpolate `{{currentVersion}}` and `{{storedVersion}}` so the operator sees both halves of the comparison.

**Defensive wrap in `loadScanResult`.** `src/kernel/adapters/sqlite/scan-load.ts` now wraps the `rowToNode` / `rowToLink` / `rowToIssue` mapping in a single try/catch. When `parseConfidence`, `parseLinkKind`, or `parseSeverity` throws inside the row mapping (closed-union violation on a value an older CLI does not know how to parse), we re-throw with the version-skew hint via the new `scanLoadDbVersionLoadWrapped` template in `src/kernel/i18n/storage.texts.ts`. The original parser message is interpolated into `{{cause}}` so the diagnostic signal stays intact for bug reports; the `cause` Error chain is preserved. This is the last-line defence for the case where `scan_meta` was lost to a manual reset, so the up-front classifier returned `no-meta` and we still need to fail meaningfully when an incompatible row shows up downstream.

**No schema migration was needed.** `scan_meta.scanned_by_version` was already persisted by `persistScanResult` / `loadScanResult` (the column landed with the original `001_initial.sql`). The work shrank from "Step 1: add metadata storage" to "verify the existing column is enough" (it was).

**Tests.** Sixteen new cases in `src/kernel/adapters/sqlite/__tests__/db-version-check.spec.ts` cover the classifier (every outcome cell), the runner's dedup keyed on `dbPath`, the two error paths' `DbVersionMismatchError` shape, the `no-meta` early-return, and the defensive wrap in `loadScanResult`.

Pre-1.0 minor per `spec/versioning.md`. No `spec/` files touched.

## User-facing

`sm` now detects when the local `.skill-map/` DB was written by an incompatible CLI version: newer minor or different major refuses to open with a clear hint; older same-major prints a one-shot warning and continues. Defensive parse errors include the same hint.
