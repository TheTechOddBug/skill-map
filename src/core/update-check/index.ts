/**
 * Pure helpers for the "update available" notification feature.
 *
 * Three responsibilities:
 *   - `fetchLatestVersion` , query `https://registry.npmjs.org/<pkg>/latest`
 *                             with `AbortController` + timeout. Throws on
 *                             non-200 / parse failure / abort.
 *   - `compareVersions`    , semver compare (-1 / 0 / 1). Pre-1.0 aware:
 *                             treats prereleases via the standard rules
 *                             (release > prerelease at the same triple).
 *   - `isOutdated`         , sugar over `compareVersions` for the common
 *                             "is `latest` strictly greater than `current`"
 *                             check the banner runs against.
 *
 * Pure kernel module, NO `process.env` reads, NO Node globals beyond the
 * built-in `fetch` / `AbortController` (Node 22+). Every env / settings
 * lookup happens in `src/cli/util/update-check-banner.ts`, the CLI-side
 * adapter that owns side effects.
 *
 * The shared cache type (`IUpdateCheckCache`) is used by the storage
 * helpers under `kernel/storage/update-check.ts` and by the BFF's
 * `GET /api/update-status` projection. A second type
 * (`IUpdateStatus`) shapes the BFF response, it merges `current`
 * (from `VERSION`) into the cache so the UI can render without a
 * second lookup. Both stay flat, no nested objects, so JSON
 * serialization is trivial.
 */

export interface IUpdateCheckCache {
  latestVersion: string;
  /** Epoch ms, when the registry was last successfully probed. */
  checkedAt: number;
  /** Epoch ms, when the banner was last printed; null = never shown yet. */
  shownAt: number | null;
}

export interface IUpdateStatus {
  /** CLI's own version, threaded in from `VERSION`. */
  current: string;
  latest: string;
  isOutdated: boolean;
  checkedAt: number;
  shownAt: number | null;
}

export interface IFetchLatestVersionOptions {
  /** Abort the request after this many ms. Required (no default). */
  timeoutMs: number;
}

interface INpmLatestPayload {
  version?: unknown;
}

/**
 * Audit L3, accept only payloads whose `version` is a string in a
 * semver-shaped form (`MAJOR.MINOR.PATCH` with optional prerelease /
 * build metadata). The pattern is intentionally permissive about
 * leading-zero rules so it stays a syntactic guard rather than a full
 * semver re-implementation (`compareVersions` parses semantically).
 * Rejecting non-conforming strings means a registry response that
 * passes type checks but smuggles arbitrary content (HTML, ANSI,
 * shell metacharacters) never lands in `IUpdateCheckCache.latestVersion`
 * and therefore never reaches the banner renderer.
 */
const SEMVER_SHAPE_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * `GET https://registry.npmjs.org/<pkg>/latest` with `AbortController`
 * + timeout. Returns the `version` field on success.
 *
 * Throws on:
 *   - network / DNS failure (relayed from `fetch`),
 *   - timeout (AbortError, message starts with "The operation was aborted"),
 *   - non-2xx HTTP status,
 *   - response that is not valid JSON or lacks a string `version` field.
 *
 * Callers are expected to swallow the throw silently, failure to
 * detect an update is never user-facing.
 */
export async function fetchLatestVersion(
  pkg: string,
  opts: IFetchLatestVersionOptions,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const url = `https://registry.npmjs.org/${pkg}/latest`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`registry returned status ${response.status}`);
    }
    const payload = (await response.json()) as INpmLatestPayload;
    if (typeof payload.version !== 'string' || payload.version.length === 0) {
      throw new Error('registry payload missing string `version`');
    }
    if (!SEMVER_SHAPE_RE.test(payload.version)) {
      throw new Error('registry payload `version` is not a semver-shaped string');
    }
    return payload.version;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Semver compare returning -1 / 0 / 1.
 *
 * Rules (per semver 2.0.0 §11):
 *   1. Compare major, minor, patch numerically. First difference wins.
 *   2. A version with NO prerelease is greater than one WITH a prerelease
 *      at the same `M.m.p` triple.
 *   3. Prerelease identifiers compare field-by-field: numeric vs numeric
 *      numerically, alpha vs alpha lexicographically; numeric < alpha.
 *      A shorter prerelease (with all earlier fields equal) is smaller.
 *   4. Build metadata (after `+`) is ignored.
 *
 * Malformed input (cannot extract major.minor.patch as integers) returns
 * `0`, the caller treats "can't tell" as "not outdated" and silently
 * skips the banner. Throwing here would force every consumer to wrap
 * the call in try/catch even though the only sensible recovery IS the
 * silent path.
 */
// Cyclomatic complexity is high by construction, semver §11 requires
// the prerelease-vs-release branching the rule counts. Splitting any
// further (extract the prerelease prefix-comparison into a helper)
// would scatter the algorithm without making it clearer.
// eslint-disable-next-line complexity
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa === null || pb === null) return 0;

  for (let i = 0; i < 3; i += 1) {
    const da = pa.release[i] ?? 0;
    const db = pb.release[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }

  // Equal release triple, fall through to prerelease comparison.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** True iff `latest > current` (i.e. `compareVersions(current, latest) < 0`). */
export function isOutdated(current: string, latest: string): boolean {
  return compareVersions(current, latest) < 0;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface IParsedSemver {
  release: [number, number, number];
  prerelease: ReadonlyArray<string | number>;
}

const SEMVER_RE =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

// Branch count is dominated by per-field validation (each capture group
// can be missing / empty / numeric / alpha), splitting further would
// break the parser into helpers that share state by reference.
// eslint-disable-next-line complexity
function parseSemver(input: string): IParsedSemver | null {
  if (typeof input !== 'string') return null;
  const match = SEMVER_RE.exec(input.trim());
  if (!match) return null;
  const major = Number.parseInt(match[1] ?? '', 10);
  const minor = Number.parseInt(match[2] ?? '', 10);
  const patch = Number.parseInt(match[3] ?? '', 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }
  const prereleaseRaw = match[4] ?? '';
  const prerelease: Array<string | number> = [];
  if (prereleaseRaw.length > 0) {
    for (const id of prereleaseRaw.split('.')) {
      if (id.length === 0) return null;
      // Numeric identifier: digits only, no leading zero (unless the
      // identifier is just "0"). Anything else is a string identifier.
      if (/^(0|[1-9]\d*)$/.test(id)) {
        prerelease.push(Number.parseInt(id, 10));
      } else {
        prerelease.push(id);
      }
    }
  }
  return { release: [major, minor, patch], prerelease };
}

// Per semver §11 the comparison interleaves type-check (numeric vs
// alpha), value compare, and length tie-break, naturally branchy.
// eslint-disable-next-line complexity
function comparePrerelease(
  a: ReadonlyArray<string | number>,
  b: ReadonlyArray<string | number>,
): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const ai = a[i];
    const bi = b[i];
    const aIsNum = typeof ai === 'number';
    const bIsNum = typeof bi === 'number';
    if (aIsNum && !bIsNum) return -1; // numeric < alpha
    if (!aIsNum && bIsNum) return 1;
    if (aIsNum && bIsNum) {
      if (ai !== bi) return (ai as number) < (bi as number) ? -1 : 1;
      continue;
    }
    // both alpha
    if (ai !== bi) return (ai as string) < (bi as string) ? -1 : 1;
  }
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return 0;
}
