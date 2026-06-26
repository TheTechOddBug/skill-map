/**
 * Pre-1.0 schema-drift rebuild for write-side DB opens.
 *
 * The project DB is a derived cache: `scan_*` is regenerable and the
 * operator's authored data lives in `.sm` sidecars, not in SQLite.
 * While the kernel stays in `0.Y.Z` it does NOT ship incremental
 * migrations to carry an old DB across a schema change. Instead, before
 * `sm scan` / `sm watch` / `sm serve` (and the BFF watcher) persist or
 * boot, this module detects drift on TWO independent axes; either one
 * trips a rebuild:
 *
 *   1. Version, `scan_meta.scanned_by_version` vs the running CLI:
 *      - same `major.minor` (patch ignored) → compatible.
 *      - any minor or major difference → drift.
 *   2. Schema fingerprint, `scan_meta.schema_fingerprint` vs the sha256
 *      of the currently-bundled migration DDL. The greenfield posture
 *      adds columns INLINE to `001_initial.sql` with NO version bump, so
 *      a DB on the same major.minor can still carry an older schema; the
 *      fingerprint catches exactly that. A NULL / missing stored
 *      fingerprint (a DB written by a pre-fingerprint CLI) also reads as
 *      drift so the detector column gets provisioned on a one-time
 *      rebuild.
 *
 * On drift the DB file (+ `-wal` / `-shm`) is deleted so the following
 * open recreates it from the current migrations and the scan repopulates
 * it. No backup (the cache is derived). A DB that was never scanned (no
 * `scan_meta` row) carries no version and no fingerprint, so it is NOT
 * drift and the open proceeds untouched.
 *
 * The rebuild is confirmed interactively on a TTY (`sm scan`, `sm serve`)
 * unless `assumeYes` is set (`--yes`, the BFF, the watcher) or stdin is
 * not a TTY (piped / CI). Declining returns `aborted`; the caller
 * surfaces a clean message and exits without deleting anything. The
 * message names the reason (version skew vs schema change).
 *
 * Read-side verbs do NOT route through here, they keep the soft / hard
 * version-skew advisory in `db-version-check.ts` so a read never
 * silently discards the cache. The classifier itself is shared: this
 * module reuses `classifyVersionSkew` for the major.minor comparison.
 *
 * See `spec/db-schema.md` §Schema drift (pre-1.0). Post-1.0 this is
 * replaced by real up-only migrations.
 */

import { createInterface } from 'node:readline';

import { classifyVersionSkew, readScannedByVersion } from './db-version-check.js';
import { removeDbFiles } from './db-files.js';
import { classifyFingerprint } from '../../kernel/adapters/sqlite/schema-fingerprint.js';
import { DB_DRIFT_TEXTS } from './i18n/db-drift.texts.js';
import { tx } from '../../kernel/util/tx.js';
import type { IPrinter } from '../runtime/printer.js';

export interface IDriftResetStyle {
  warnGlyph?: string;
  dim?: (s: string) => string;
}

export interface IDriftResetPolicy {
  /** Running CLI version, threaded from `src/version.ts`. */
  currentVersion: string;
  /**
   * Skip the confirmation prompt and rebuild unconditionally. Set by
   * `--yes`, the BFF scan route, and the watcher (none of which has an
   * operator at a prompt). When false, a TTY stdin is prompted; a
   * non-TTY stdin rebuilds without asking.
   */
  assumeYes?: boolean;
  stdin?: NodeJS.ReadableStream;
  stderr?: NodeJS.WritableStream;
  /** Prints the post-rebuild receipt. Omit for a silent rebuild (watcher). */
  printer?: IPrinter;
  style?: IDriftResetStyle;
}

/**
 * Why the cache is being rebuilt. `version` = the recorded
 * `scanned_by_version` differs at major.minor. `schema` = the recorded
 * `schema_fingerprint` (or its absence) differs from the bundled
 * migration DDL, an inline schema change the version did not bump. Threaded
 * onto every drift outcome + the rendered message so the operator sees
 * the cause.
 */
export type TDriftReason = 'version' | 'schema';

export type TDriftResetOutcome =
  | { kind: 'no-drift' }
  | { kind: 'reset'; dbVersion: string; currentVersion: string; reason: TDriftReason }
  | { kind: 'aborted'; dbVersion: string; currentVersion: string; reason: TDriftReason };

/**
 * Detect schema drift by version OR fingerprint and, when found, confirm
 * + delete the DB so the next open recreates it. Best-effort: an absent
 * file, an absent `scan_meta` row, or an unparseable version string is
 * "no signal" → `no-drift` (mirrors `detectDbVersionSkew`'s posture).
 *
 * The version axis is checked first (it is the more specific signal: a
 * minor/major skew is reported as `version` even if the fingerprint also
 * differs). A same-major.minor DB then falls through to the fingerprint
 * axis, which catches an inline `001_initial.sql` edit the version
 * cannot see.
 */
export async function maybeResetOnDrift(
  dbPath: string,
  policy: IDriftResetPolicy,
): Promise<TDriftResetOutcome> {
  const reason = detectDriftReason(dbPath, policy.currentVersion);
  if (reason === null) return { kind: 'no-drift' };

  // `dbVersion` is best-effort: a fingerprint-only drift on a DB whose
  // `scanned_by_version` is still readable shows the real version; the
  // rare "scan_meta row exists but version unreadable" case falls back
  // to a stable placeholder so the message stays well-formed.
  const dbVersion = readScannedByVersion(dbPath) ?? 'unknown';

  // Prompt only when an interactive operator is present; otherwise the
  // rebuild is automatic (assumeYes / non-TTY / BFF / watcher).
  const prompted = shouldPromptForReset(policy);
  const confirmed = prompted ? await askDriftReset(dbVersion, reason, policy) : true;
  if (!confirmed) {
    return { kind: 'aborted', dbVersion, currentVersion: policy.currentVersion, reason };
  }
  await removeDbFiles(dbPath);
  // Receipt only when the rebuild was automatic. After an interactive
  // y/N confirm the operator already knows the cache was rebuilt, so
  // repeating it just adds noise; a silent rebuild gets the one-line
  // notice because nothing else signalled the wipe.
  if (!prompted) renderResetReceipt(dbVersion, policy);
  return { kind: 'reset', dbVersion, currentVersion: policy.currentVersion, reason };
}

/**
 * Classify the on-disk DB against both drift axes. Returns the reason
 * (`version` wins over `schema` when both fire, it is the more specific
 * skew) or `null` for "no drift / no signal".
 *
 *   - No `scan_meta` row (never scanned) → both axes report no-signal →
 *     `null`. Silent, exactly like today's version handling.
 *   - Version skew (minor/major) → `'version'`.
 *   - Same major.minor but fingerprint differs / is absent → `'schema'`.
 */
function detectDriftReason(dbPath: string, currentVersion: string): TDriftReason | null {
  const dbVersion = readScannedByVersion(dbPath);
  if (dbVersion !== null) {
    const skew = classifyVersionSkew(dbVersion, currentVersion);
    // `ok` (same major.minor) and `no-meta` (unparseable) are not a
    // version-axis signal; fall through to the fingerprint axis below.
    if (skew.kind !== 'ok' && skew.kind !== 'no-meta') return 'version';
  }
  // Fingerprint axis. `no-meta` (no scan_meta row) is no-signal;
  // `drift` (mismatch OR a NULL / missing column) is schema drift.
  return classifyFingerprint(dbPath).kind === 'drift' ? 'schema' : null;
}

/** Render the human reason fragment interpolated as `{{reason}}`. */
function reasonText(reason: TDriftReason): string {
  return reason === 'version'
    ? DB_DRIFT_TEXTS.driftReasonVersion
    : DB_DRIFT_TEXTS.driftReasonSchema;
}

/** True only when an interactive operator is present to answer y/N. */
function shouldPromptForReset(policy: IDriftResetPolicy): boolean {
  if (policy.assumeYes) return false;
  if (!policy.stdin || !policy.stderr) return false;
  return (policy.stdin as { isTTY?: boolean }).isTTY === true;
}

/**
 * Write the §3.1b block to stderr and read a `y/N` answer. Only called
 * when `shouldPromptForReset` confirmed both streams are present.
 */
async function askDriftReset(
  dbVersion: string,
  reason: TDriftReason,
  policy: IDriftResetPolicy,
): Promise<boolean> {
  const warnGlyph = policy.style?.warnGlyph ?? '⚠';
  const dim = policy.style?.dim ?? ((s: string) => s);
  policy.stderr!.write(
    tx(DB_DRIFT_TEXTS.driftPrompt, {
      glyph: warnGlyph,
      dbVersion,
      currentVersion: policy.currentVersion,
      reason: reasonText(reason),
      hint: dim(DB_DRIFT_TEXTS.driftPromptHint),
    }),
  );
  const rl = createInterface({ input: policy.stdin!, output: policy.stderr! });
  try {
    const answer = await new Promise<string>((resolveP) =>
      rl.question(DB_DRIFT_TEXTS.driftPromptQuestion, resolveP),
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Print the post-rebuild receipt when the caller supplied a printer. */
function renderResetReceipt(
  dbVersion: string,
  policy: IDriftResetPolicy,
): void {
  if (!policy.printer) return;
  const warnGlyph = policy.style?.warnGlyph ?? '⚠';
  const dim = policy.style?.dim ?? ((s: string) => s);
  policy.printer.warn(
    tx(DB_DRIFT_TEXTS.driftReset, {
      glyph: warnGlyph,
      dbVersion,
      currentVersion: policy.currentVersion,
      hint: dim(DB_DRIFT_TEXTS.driftResetHint),
    }),
  );
}
