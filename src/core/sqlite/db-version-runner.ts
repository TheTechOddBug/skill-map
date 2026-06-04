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
  DbVersionMismatchError,
  detectDbVersionSkew,
  type TDbVersionCheckOutcome,
} from './db-version-check.js';
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
