/**
 * Seam between `detectDbVersionSkew` (pure classifier) and the CLI /
 * BFF surfaces that actually render the message. Owns:
 *
 *   - rendering each outcome to the §3.1b error / warning block format
 *     defined by `context/cli-output-style.md`,
 *   - de-duplicating the soft warning so multiple `sm` verbs in the
 *     same process (refresh + bump + show against the same DB) print
 *     it at most once per DB path,
 *   - throwing `DbVersionMismatchError` on the two error classifications
 *     so the caller short-circuits BEFORE the downstream scan-load /
 *     parseConfidence path can throw its cryptic enum error.
 *
 * `style` is optional. When omitted (BFF, non-TTY callers) the glyphs
 * fall back to bare characters (`✕` / `⚠`) and the dim wrapper is the
 * identity. Colour resolution stays in the CLI seam via `ansiFor`,
 * keeping `core/sqlite/` free of `process.env` reads per the kernel
 * boundary lint.
 */

import {
  classifyVersionSkew,
  DbSchemaDriftError,
  DbVersionMismatchError,
  detectDbVersionSkew,
  readScannedByVersion,
  type TDbVersionCheckOutcome,
} from './db-version-check.js';
import { VERSION } from '../../version.js';
import { classifyFingerprint } from '../../kernel/adapters/sqlite/schema-fingerprint.js';
import { DB_VERSION_TEXTS } from './i18n/db-version.texts.js';
import { tx } from '../../kernel/util/tx.js';
import type { IPrinter } from '../runtime/printer.js';
import type { Kysely } from 'kysely';
import type { IDatabase } from '../../kernel/adapters/sqlite/schema.js';

export interface IDbVersionCheckStyle {
  warnGlyph?: string;
  errorGlyph?: string;
  dim?: (s: string) => string;
}

export interface IRunDbVersionCheckOpts {
  /** Current CLI version, threaded from `src/version.ts`. */
  currentVersion: string;
  /**
   * Stable identifier for the DB the check is running against. The
   * runner caches "warning already rendered for this id" so a verb
   * that opens the DB twice (or two verbs in the same process) does
   * not double-print the soft `warn-older` advisory. Errors always
   * throw, the cache only suppresses the warning branch.
   */
  dbPath: string;
  printer?: IPrinter;
  style?: IDbVersionCheckStyle;
  /**
   * Override the cache used to dedupe the warning. Tests pass a fresh
   * `Set` per case to keep cases independent; production code leaves
   * this undefined and shares the module-level cache.
   */
  warnSeen?: Set<string>;
}

/**
 * Module-level cache of DB paths for which the soft warning was
 * already printed in this process. Verbs share it implicitly so the
 * dedupe rule holds across multiple `withSqlite` opens in a single
 * `sm` invocation.
 */
const WARN_SEEN = new Set<string>();

/**
 * Read the version metadata from the open DB, classify against
 * `currentVersion`, and render / throw per the contract. Returns the
 * outcome so the caller can branch (e.g. a `--json` consumer that
 * wants to translate the warning to a structured envelope), but for
 * the human path the rendering is already done.
 */
export async function runDbVersionCheck(
  db: Kysely<IDatabase>,
  opts: IRunDbVersionCheckOpts,
): Promise<TDbVersionCheckOutcome> {
  const versionOutcome = await detectDbVersionSkew(db, opts.currentVersion);
  const outcome = layerFingerprintOutcome(versionOutcome, opts);
  applyDbVersionOutcome(outcome, opts);
  return outcome;
}

/**
 * Second drift axis for the read side: when the version comparison was
 * `ok` (same major.minor), check the recorded `schema_fingerprint`
 * against the bundled migration DDL and upgrade to `warn-schema` on a
 * mismatch (or a NULL / missing column from a pre-fingerprint DB). The
 * version axis is more specific, so a version error / warn is left
 * untouched. `no-meta` (never scanned) stays silent: the fingerprint
 * reader returns `no-meta` there too, no signal.
 *
 * The fingerprint reader is path-based + defensive (it opens its own
 * short-lived read-only handle), so it consumes `opts.dbPath`, not the
 * live Kysely handle. `:memory:` resolves to `no-meta` and is therefore
 * never upgraded.
 */
function layerFingerprintOutcome(
  versionOutcome: TDbVersionCheckOutcome,
  opts: IRunDbVersionCheckOpts,
): TDbVersionCheckOutcome {
  if (versionOutcome.kind !== 'ok') return versionOutcome;
  const fp = classifyFingerprint(opts.dbPath);
  if (fp.kind === 'drift') return { kind: 'warn-schema', currentVersion: opts.currentVersion };
  return versionOutcome;
}

/**
 * Pure renderer / dispatcher, exposed for unit tests that want to
 * assert on the message + throw behaviour without standing up a DB.
 * Also reused by `runDbVersionCheck` after the DB read. The body is
 * a thin switch; each branch lives in its own helper so the dispatch
 * stays under the complexity cap and the renderers can grow
 * independently.
 */
export function applyDbVersionOutcome(
  outcome: TDbVersionCheckOutcome,
  opts: IRunDbVersionCheckOpts,
): void {
  switch (outcome.kind) {
    case 'ok':
    case 'no-meta':
      return;
    case 'error-newer':
      throw renderErrorNewer(outcome, opts);
    case 'error-major':
      throw renderErrorMajor(outcome, opts);
    case 'warn-older':
      renderWarnOlder(outcome, opts);
      break;
    case 'warn-schema':
      renderWarnSchema(outcome, opts);
      break;
  }
}

function renderErrorNewer(
  outcome: Extract<TDbVersionCheckOutcome, { kind: 'error-newer' }>,
  opts: IRunDbVersionCheckOpts,
): DbVersionMismatchError {
  const errorGlyph = opts.style?.errorGlyph ?? '✕';
  const dim = opts.style?.dim ?? ((s: string) => s);
  const humanMessage = tx(DB_VERSION_TEXTS.dbVersionTooNew, {
    glyph: errorGlyph,
    dbVersion: outcome.dbVersion,
    currentVersion: outcome.currentVersion,
    hint: dim(DB_VERSION_TEXTS.dbVersionTooNewHint),
  });
  return new DbVersionMismatchError({
    kind: 'error-newer',
    dbVersion: outcome.dbVersion,
    currentVersion: outcome.currentVersion,
    humanMessage,
  });
}

function renderErrorMajor(
  outcome: Extract<TDbVersionCheckOutcome, { kind: 'error-major' }>,
  opts: IRunDbVersionCheckOpts,
): DbVersionMismatchError {
  const errorGlyph = opts.style?.errorGlyph ?? '✕';
  const dim = opts.style?.dim ?? ((s: string) => s);
  const hint = tx(DB_VERSION_TEXTS.dbVersionMajorMismatchHint, {
    dbMajor: outcome.dbMajor,
  });
  const humanMessage = tx(DB_VERSION_TEXTS.dbVersionMajorMismatch, {
    glyph: errorGlyph,
    dbVersion: outcome.dbVersion,
    currentVersion: outcome.currentVersion,
    hint: dim(hint),
  });
  return new DbVersionMismatchError({
    kind: 'error-major',
    dbVersion: outcome.dbVersion,
    currentVersion: outcome.currentVersion,
    humanMessage,
  });
}

/**
 * Render the soft `warn-older` advisory at most once per DB path
 * per process. `opts.warnSeen` overrides the module-level cache so
 * tests can isolate cases.
 */
function renderWarnOlder(
  outcome: Extract<TDbVersionCheckOutcome, { kind: 'warn-older' }>,
  opts: IRunDbVersionCheckOpts,
): void {
  const seen = opts.warnSeen ?? WARN_SEEN;
  if (seen.has(opts.dbPath)) return;
  seen.add(opts.dbPath);
  if (!opts.printer) return;
  const warnGlyph = opts.style?.warnGlyph ?? '⚠';
  const dim = opts.style?.dim ?? ((s: string) => s);
  opts.printer.warn(
    tx(DB_VERSION_TEXTS.dbVersionOlder, {
      glyph: warnGlyph,
      dbVersion: outcome.dbVersion,
      currentVersion: outcome.currentVersion,
      hint: dim(DB_VERSION_TEXTS.dbVersionOlderHint),
    }),
  );
}

/**
 * Render the soft `warn-schema` advisory at most once per DB path per
 * process. Fires when the version matched at major.minor but the
 * recorded schema fingerprint did not, an inline `001_initial.sql`
 * change the version did not bump (greenfield posture), or a
 * pre-fingerprint DB whose `schema_fingerprint` column / value is
 * absent. The read continues (it does NOT refuse, per spec/db-schema.md
 * §Schema drift), but a query may hit a missing column; the message
 * points the operator at `sm scan` / `sm db reset`. Shares the
 * `warn-older` dedupe cache (the two are mutually exclusive per open
 * since `warn-schema` requires a version-`ok` DB).
 */
function renderWarnSchema(
  outcome: Extract<TDbVersionCheckOutcome, { kind: 'warn-schema' }>,
  opts: IRunDbVersionCheckOpts,
): void {
  const seen = opts.warnSeen ?? WARN_SEEN;
  if (seen.has(opts.dbPath)) return;
  seen.add(opts.dbPath);
  if (!opts.printer) return;
  const warnGlyph = opts.style?.warnGlyph ?? '⚠';
  const dim = opts.style?.dim ?? ((s: string) => s);
  opts.printer.warn(
    tx(DB_VERSION_TEXTS.dbSchemaDrift, {
      glyph: warnGlyph,
      currentVersion: outcome.currentVersion,
      hint: dim(DB_VERSION_TEXTS.dbSchemaDriftHint),
    }),
  );
}

/**
 * Test-only escape hatch, clears the module-level "warning already
 * printed" cache. The runner exposes this so unit tests that share
 * the production cache (no explicit `warnSeen` override) can reset
 * between cases. Production callers MUST NOT touch this; the cache
 * is process-scoped by design.
 */
export function resetDbVersionWarnCacheForTests(): void {
  WARN_SEEN.clear();
}

/**
 * WRITE-side drift guard. Runs at `withSqlite` open when NO `versionCheck`
 * bag was passed (the read-side path) AND the caller did not opt out via
 * `skipDriftCheck` (scan / watch, which own drift by rebuilding). Reuses
 * the SAME schema-fingerprint classification the read-side advisory layers
 * on (`classifyFingerprint`, memoized `schemaFingerprint()` + the defensive
 * `readStoredFingerprint`), so no new hashing and no new DB scan is added:
 *
 *   - `no-meta` (never scanned) → no-op, no signal (mirrors the version
 *     check's `no-meta` posture).
 *   - `ok` (stored fingerprint matches the bundled migrations) → no-op.
 *   - `drift` (stored fingerprint differs, is NULL, or the column is
 *     absent) → throw `DbSchemaDriftError`. A mutation against the older
 *     on-disk schema would otherwise crash with `CHECK constraint failed`
 *     / `no such column`; the guard refuses with an actionable advisory
 *     instead.
 *
 * Fingerprint axis only: a pure version bump with no schema change keeps
 * the fingerprint stable, so it never trips this (writing the same columns
 * is safe). Any inline migration DDL edit changes the fingerprint and does
 * trip it. Version-newer / different-major skew is a READ-side concern
 * (`runDbVersionCheck`); write verbs only care whether the columns they
 * are about to write still exist.
 *
 * Path-based, not handle-based: `classifyFingerprint(dbPath)` opens its own
 * short-lived read-only handle, exactly like the read-side
 * `layerFingerprintOutcome` does, so the guard never reaches for the live
 * Kysely handle. Bare `✕` glyph (no colour / dim): the default write open
 * carries no CLI style bag, matching how the version renderers fall back
 * when `style` is absent.
 */
/**
 * Verb-level WRITE gate (`spec/cli-contract.md` §Schema-drift rebuild,
 * write bullet): non-drift-owning write verbs (`sm jobs submit` /
 * `cancel` / `fail` / `prune`, `sm record`, `sm findings prune`) call
 * this FIRST, before loading the plugin runtime and before any adapter
 * open, so a drifted DB refuses with the clean advisory instead of a
 * misleading downstream symptom (observed live: `sm jobs submit` on a
 * drifted DB reported `extension not found` because the plugin trust
 * read degraded, three layers from the cause).
 *
 * Both drift axes are checked, path-based (short-lived read-only
 * handles, no live adapter):
 *
 *   - VERSION axis: `scan_meta.scanned_by_version` vs the running CLI.
 *     A minor or major difference is drift; the read side merely warns
 *     on an older same-major DB, a write refuses. Newer / different
 *     major throws the same `DbVersionMismatchError` the read side
 *     uses; an older minor throws `DbSchemaDriftError` with the
 *     version-flavoured write advisory.
 *   - FINGERPRINT axis: delegated to `runWriteSideDriftCheck` (the
 *     `withSqlite` default guard stays as the backstop for opens that
 *     bypass this gate).
 *
 * `no-meta` (never scanned / unreadable) stays silent on both axes.
 * Throws propagate to the `SmCommand` boundary, which renders the
 * `humanMessage` block and exits 2.
 */
export function assertNoDriftForWrite(dbPath: string, currentVersion: string = VERSION): void {
  const dbVersion = readScannedByVersion(dbPath);
  if (dbVersion !== null) {
    const outcome = classifyVersionSkew(dbVersion, currentVersion);
    if (outcome.kind === 'error-newer') {
      throw renderErrorNewer(outcome, { currentVersion, dbPath });
    }
    if (outcome.kind === 'error-major') {
      throw renderErrorMajor(outcome, { currentVersion, dbPath });
    }
    if (outcome.kind === 'warn-older') {
      throw new DbSchemaDriftError({
        message: tx(DB_VERSION_TEXTS.dbVersionDriftWritePlain, {
          dbVersion: outcome.dbVersion,
          currentVersion,
        }),
        humanMessage: tx(DB_VERSION_TEXTS.dbVersionDriftWrite, {
          glyph: '✕',
          dbVersion: outcome.dbVersion,
          currentVersion,
          hint: DB_VERSION_TEXTS.dbVersionDriftWriteHint,
        }),
      });
    }
  }
  runWriteSideDriftCheck(dbPath, currentVersion);
}

/**
 * READ-side failure conversion (`spec/cli-contract.md` §Schema-drift
 * rebuild, read bullet). When a read verb's advisory DETECTED drift
 * (warn-older / warn-schema) and the attempted read then failed, the
 * failure is the drift materialising (a query touching a column the
 * stored schema predates), so it surfaces as the clean drift advisory
 * instead of the raw SQL error (observed live: `sm findings` printed
 * the advisory then crashed with `no such column`). The sanitized
 * cause rides only on the plain `message` (BFF envelope /
 * diagnostics); the human block stays clean.
 *
 * Callers MUST scope this to the drift-detected case: on a healthy DB
 * a query failure is a genuine bug and rethrows untouched (see
 * `withSqlite`).
 */
export function wrapDriftedReadFailure(
  cause: unknown,
  opts: Pick<IRunDbVersionCheckOpts, 'currentVersion' | 'style'>,
): DbSchemaDriftError {
  const errorGlyph = opts.style?.errorGlyph ?? '✕';
  const dim = opts.style?.dim ?? ((s: string) => s);
  const causeText = cause instanceof Error ? cause.message : String(cause);
  return new DbSchemaDriftError({
    message: tx(DB_VERSION_TEXTS.dbSchemaDriftReadFailedPlain, {
      currentVersion: opts.currentVersion,
      cause: causeText,
    }),
    humanMessage: tx(DB_VERSION_TEXTS.dbSchemaDriftReadFailed, {
      glyph: errorGlyph,
      currentVersion: opts.currentVersion,
      hint: dim(DB_VERSION_TEXTS.dbSchemaDriftReadFailedHint),
    }),
  });
}

export function runWriteSideDriftCheck(dbPath: string, currentVersion: string): void {
  if (classifyFingerprint(dbPath).kind !== 'drift') return;
  const humanMessage = tx(DB_VERSION_TEXTS.dbSchemaDriftWrite, {
    glyph: '✕',
    currentVersion,
    hint: DB_VERSION_TEXTS.dbSchemaDriftWriteHint,
  });
  const message = tx(DB_VERSION_TEXTS.dbSchemaDriftWritePlain, { currentVersion });
  throw new DbSchemaDriftError({ message, humanMessage });
}
