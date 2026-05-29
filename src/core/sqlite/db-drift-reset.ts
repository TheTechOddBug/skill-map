/**
 * Pre-1.0 schema-drift rebuild for write-side DB opens.
 *
 * The project DB is a derived cache: `scan_*` is regenerable and the
 * operator's authored data lives in `.sm` sidecars, not in SQLite.
 * While the kernel stays in `0.Y.Z` it does NOT ship incremental
 * migrations to carry an old DB across a schema change. Instead, before
 * `sm scan` / `sm watch` (and the BFF watcher) persist, this module
 * compares `scan_meta.scanned_by_version` against the running CLI:
 *
 *   - same `major.minor` (patch ignored) → compatible, no rebuild.
 *   - any minor or major difference → the on-disk schema is treated as
 *     drifted; the DB file (+ `-wal` / `-shm`) is deleted so the
 *     following open recreates it from `001_initial.sql` and the scan
 *     repopulates it. No backup (the cache is derived).
 *
 * The rebuild is confirmed interactively on a TTY `sm scan` unless
 * `assumeYes` is set (`--yes`, the BFF, the watcher) or stdin is not a
 * TTY (piped / CI). Declining returns `aborted`; the caller surfaces a
 * clean message and exits without deleting anything.
 *
 * Read-side verbs do NOT route through here, they keep the soft / hard
 * version-skew advisory in `db-version-check.ts` so a read never
 * silently discards the cache. The classifier itself is shared: this
 * module reuses `classifyVersionSkew` for the major.minor comparison.
 *
 * See `spec/db-schema.md` §Schema drift (pre-1.0). Post-1.0 this is
 * replaced by real up-only migrations.
 */

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

import { classifyVersionSkew } from './db-version-check.js';
import { removeDbFiles } from './db-files.js';
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

export type TDriftResetOutcome =
  | { kind: 'no-drift' }
  | { kind: 'reset'; dbVersion: string; currentVersion: string }
  | { kind: 'aborted'; dbVersion: string; currentVersion: string };

/**
 * Detect schema drift by version and, when found, confirm + delete the
 * DB so the next open recreates it. Best-effort: an absent file,
 * absent `scan_meta`, or an unreadable / unparseable version string is
 * "no signal" → `no-drift` (mirrors `detectDbVersionSkew`'s posture).
 */
export async function maybeResetOnDrift(
  dbPath: string,
  policy: IDriftResetPolicy,
): Promise<TDriftResetOutcome> {
  const dbVersion = readScannedByVersion(dbPath);
  if (dbVersion === null) return { kind: 'no-drift' };

  const skew = classifyVersionSkew(dbVersion, policy.currentVersion);
  // `ok` (same major.minor) and `no-meta` (unparseable) are compatible
  // / no-signal. Everything else (older / newer minor, different major)
  // is drift per spec/db-schema.md §Schema drift (pre-1.0).
  if (skew.kind === 'ok' || skew.kind === 'no-meta') return { kind: 'no-drift' };

  const confirmed = await confirmDriftReset(dbVersion, policy);
  if (!confirmed) {
    return { kind: 'aborted', dbVersion, currentVersion: policy.currentVersion };
  }
  await removeDbFiles(dbPath);
  renderResetReceipt(dbVersion, policy);
  return { kind: 'reset', dbVersion, currentVersion: policy.currentVersion };
}

/**
 * Read `scan_meta.scanned_by_version` from an existing DB file via a
 * short-lived read-only handle. Returns `null` for `:memory:`, a
 * missing file, an absent `scan_meta` row, or any open / query error.
 */
function readScannedByVersion(dbPath: string): string | null {
  if (dbPath === ':memory:' || !existsSync(dbPath)) return null;
  let raw: DatabaseSync | null = null;
  try {
    raw = new DatabaseSync(dbPath, { readOnly: true });
    const row = raw
      .prepare('SELECT scanned_by_version AS v FROM scan_meta LIMIT 1')
      .get() as { v?: string } | undefined;
    const v = row?.v;
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    // Unreadable / table absent / corrupt → no signal. Best-effort,
    // not a gate; the version-skew classifier takes the same stance.
    return null;
  } finally {
    raw?.close();
  }
}

/**
 * Resolve whether to proceed with the rebuild. `assumeYes` and a
 * non-TTY (or stream-less) stdin both auto-confirm: a piped / CI /
 * server scan must not block on a prompt. Otherwise ask interactively.
 */
async function confirmDriftReset(
  dbVersion: string,
  policy: IDriftResetPolicy,
): Promise<boolean> {
  if (!shouldPromptForReset(policy)) return true;
  return askDriftReset(dbVersion, policy);
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
  policy: IDriftResetPolicy,
): Promise<boolean> {
  const warnGlyph = policy.style?.warnGlyph ?? '⚠';
  const dim = policy.style?.dim ?? ((s: string) => s);
  policy.stderr!.write(
    tx(DB_DRIFT_TEXTS.driftPrompt, {
      glyph: warnGlyph,
      dbVersion,
      currentVersion: policy.currentVersion,
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
function renderResetReceipt(dbVersion: string, policy: IDriftResetPolicy): void {
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
