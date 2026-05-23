/**
 * Detect version skew between the CLI binary opening a DB and the CLI
 * that last wrote it. Surfaces a clear, actionable message instead of
 * the cryptic downstream parse failures (`Invalid Confidence value
 * 0.5`, `Invalid LinkKind value ...`) that arise when an older CLI
 * tries to read a newer DB.
 *
 * Source of truth: `scan_meta.scanned_by_version`, populated by
 * `persistScanResult` on every `sm scan`. The column is the version
 * string of the CLI that LAST wrote the scan zone; comparing it to the
 * runtime's `VERSION` constant catches the skew the operator hit
 * during the link-matrix walkthrough on 2026-05-23, an older global
 * `sm` binary opened a DB rewritten by a newer dev dist.
 *
 * Classification (per AGENTS.md §Pre-1.0, every breaking change ships
 * as a minor bump while in `0.Y.Z`, so minor-level skew is treated as
 * potentially breaking):
 *
 *   - Same `major.minor` (patch differences ignored) → `ok`. Patch
 *     bumps are guaranteed compatible by pnpm changeset policy.
 *   - DB written by a NEWER minor (same major) → `error-newer`. The
 *     CLI cannot safely read forward-compatible columns / enums.
 *     Refuse to proceed.
 *   - DB written by an OLDER minor (same major) → `warn-older`.
 *     Read continues, the next `sm scan` rewrites the metadata. The
 *     warning surfaces once per DB path per process so a verb that
 *     opens the DB multiple times (refresh + bump + show) does not
 *     repeat itself.
 *   - Different major → `error-major`. Refuse to proceed; the
 *     operator must either upgrade or wipe `.skill-map/`.
 *   - `scan_meta` absent (fresh DB, never scanned) → `no-meta`. No
 *     signal. Skip silently.
 *   - Unparseable version string on either side → `no-meta`. Same
 *     posture, the column was written by something we cannot reason
 *     about. The check is best-effort, not a security gate.
 *
 * Pure helpers, the module does not own a `printer`. The CLI / BFF
 * seam renders the outcome (see `runVersionCheck` in `with-sqlite.ts`
 * for the rendering path).
 */

import type { Kysely } from 'kysely';

import type { IDatabase } from '../../kernel/adapters/sqlite/schema.js';

export type TDbVersionCheckOutcome =
  | { kind: 'ok' }
  | { kind: 'no-meta' }
  | {
      kind: 'warn-older';
      dbVersion: string;
      currentVersion: string;
    }
  | {
      kind: 'error-newer';
      dbVersion: string;
      currentVersion: string;
    }
  | {
      kind: 'error-major';
      dbVersion: string;
      dbMajor: number;
      currentVersion: string;
      currentMajor: number;
    };

interface IVersionTriple {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Run the skew detection against the open `scan_meta` row. Pure: reads
 * once, returns a classified outcome, never throws. Returns `no-meta`
 * when the row is absent or either version string cannot be parsed,
 * the surrounding seam treats that as "skip silently".
 */
export async function detectDbVersionSkew(
  db: Kysely<IDatabase>,
  currentVersion: string,
): Promise<TDbVersionCheckOutcome> {
  const meta = await db
    .selectFrom('scan_meta')
    .select(['scannedByVersion'])
    .executeTakeFirst();
  if (!meta) return { kind: 'no-meta' };

  const dbVersion = meta.scannedByVersion;
  return classifyVersionSkew(dbVersion, currentVersion);
}

/**
 * Pure classifier exposed for unit tests, no DB needed. Both inputs
 * are version strings; the helper parses them and returns the same
 * `TDbVersionCheckOutcome` shape `detectDbVersionSkew` would.
 */
export function classifyVersionSkew(
  dbVersion: string,
  currentVersion: string,
): TDbVersionCheckOutcome {
  const dbParsed = parseVersionTriple(dbVersion);
  const currentParsed = parseVersionTriple(currentVersion);
  if (dbParsed === null || currentParsed === null) {
    // Cannot reason about an unparseable string. Stay silent.
    return { kind: 'no-meta' };
  }
  if (dbParsed.major !== currentParsed.major) {
    return {
      kind: 'error-major',
      dbVersion,
      dbMajor: dbParsed.major,
      currentVersion,
      currentMajor: currentParsed.major,
    };
  }
  if (dbParsed.minor === currentParsed.minor) {
    // Patch differences are guaranteed compatible.
    return { kind: 'ok' };
  }
  if (dbParsed.minor > currentParsed.minor) {
    return { kind: 'error-newer', dbVersion, currentVersion };
  }
  return { kind: 'warn-older', dbVersion, currentVersion };
}

/**
 * Strict version parser, accepts `MAJOR.MINOR.PATCH` plus an optional
 * prerelease (`-rc.1`, `-next.0`) and/or build metadata (`+sha.deadbeef`).
 * Returns the parsed triple or `null` for anything that does not match
 * the semver shape.
 *
 * `update-check/index.ts` carries a similar parser; we duplicate the
 * tiny shape-only piece here rather than reach across boundaries
 * because that module is concerned with semantic ordering (including
 * prerelease tie-breaks) which the version-check does not need.
 */
function parseVersionTriple(input: string): IVersionTriple | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(input.trim());
  if (!match) return null;
  const major = parseSafeInt(match[1]);
  const minor = parseSafeInt(match[2]);
  const patch = parseSafeInt(match[3]);
  if (major === null || minor === null || patch === null) return null;
  return { major, minor, patch };
}

/**
 * Parse a captured numeric group from the version regex. Returns
 * `null` when the group is missing or does not coerce to a finite
 * integer; the caller treats `null` as "not a valid triple component"
 * and short-circuits the whole parse.
 */
function parseSafeInt(raw: string | undefined): number | null {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Typed error thrown by the seam when the outcome is `error-newer` or
 * `error-major`. Carries the pre-rendered `humanMessage` so the CLI
 * verb can print it directly without re-formatting; the discriminator
 * lets a `--json` consumer translate the same outcome to a structured
 * error envelope downstream.
 */
export class DbVersionMismatchError extends Error {
  readonly kind: 'error-newer' | 'error-major';
  readonly dbVersion: string;
  readonly currentVersion: string;
  readonly humanMessage: string;

  constructor(args: {
    kind: 'error-newer' | 'error-major';
    dbVersion: string;
    currentVersion: string;
    humanMessage: string;
  }) {
    super(args.humanMessage);
    this.name = 'DbVersionMismatchError';
    this.kind = args.kind;
    this.dbVersion = args.dbVersion;
    this.currentVersion = args.currentVersion;
    this.humanMessage = args.humanMessage;
  }
}
