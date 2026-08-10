/**
 * Shared `@`-token grammar for the `@`-aware body extractors. Single source
 * of truth so the two consumers never drift (they used to carry copies with a
 * "keep in sync" comment):
 *
 *   - `core/at-file` (file-picker lenses claude / codex / antigravity): a
 *     FILE-shaped `@<path>` token becomes a `references` link resolved by path.
 *   - `claude/at-directive` (claude only): a bare `@<handle>` becomes a
 *     `mentions` link; it calls `classifyAtFileToken` to SKIP file-shaped
 *     tokens and leave them to `core/at-file`.
 *
 * The `@` grammar is NOT universal markdown (only the runtimes above read `@`
 * as a token), so neither consumer is a universal `core` extractor: both are
 * lens-gated via `precondition.provider`. The grammar itself is shared, hence
 * this neutral kernel util.
 */

import { posix as pathPosix } from 'node:path';

/**
 * Token grammar (after the leading `@`):
 *   - Optional path prefix: one or more `./` / `../` segments (so a
 *     multi-level `../../x` climbs past one directory), or a single leading
 *     `/`. Matches how the file-picker runtimes resolve a relative `@path`.
 *   - Required first identifier segment: an optional SINGLE leading dot
 *     (a hidden file or directory: `@.claude/minions.md`; 2026-08-08,
 *     mirroring the `core/backtick-path` first-segment widening, the two
 *     path grammars stay pinned to one shape per
 *     `spec/architecture.md` §code-region file references) followed by
 *     `[a-z0-9][a-z0-9_-]*`. A bare `@.` never matches (the dot demands a
 *     following alphanumeric), and `@..claude` matches nowhere (the
 *     prefix alternative needs its `/`, and a second dot cannot start the
 *     segment).
 *   - Optional path / namespace tail anchored so the LAST char is
 *     alphanumeric or `_` (excludes a trailing `.` sentence punctuation
 *     `@foo.` or `/` path separator without leaf `@dir/`).
 *   - Optional namespace marker `:` + identifier.
 *   - **At least one letter somewhere in the token** (the
 *     `(?=[0-9_\-./:]*[a-z])` lookahead right after `@`, bounded to the
 *     token's own charset so it cannot peek past the match). A purely
 *     numeric token (`@10`, `@10/20`) is prose (a score, a date, a
 *     fraction), not a handle or a path, and an unresolved match paints
 *     a red `reference-broken`; file-shaped tokens keep matching
 *     because their extension carries letters (`@10.md`). Same sweep as
 *     `slash-token.ts` / `dollar-token.ts` (2026-08-10, the three sigil
 *     grammars move as a set per runtime-quirks §8).
 * The leading char must be non-word (so emails `foo@bar.com` and `@@` don't
 * match). The match is case-insensitive; capture group 1 is the `@`-token.
 */
export const AT_TOKEN_RE =
  /(?:^|[^A-Za-z0-9_@])(@(?=[0-9_\-./:]*[a-z])(?:(?:\.{1,2}\/)+|\/)?\.?[a-z0-9](?:[a-z0-9_\-./]*[a-z0-9_])?(?::[a-z0-9][a-z0-9_-]*)?)/gi;

/**
 * File extensions skill-map treats as a strong "this is a file reference, not
 * an entity mention" signal. Conservative: only formats routinely authored in
 * docs / skills. Adding new extensions is safe (a false-positive `references`
 * is a misplaced link kind, not a broken-ref issue).
 */
const FILE_EXT_RE =
  /\.(md|mdx|js|jsx|ts|tsx|json|yml|yaml|toml|txt|html|css|scss|less|py|rb|go|rs|java|c|cpp|h|hpp|sh|sql|svg|png|jpg|jpeg|gif|webp|pdf)$/i;

/**
 * Classify a `@`-token body (the token minus the leading `@`). Returns the
 * Signal `rationale` for a FILE-shaped token (a relative path prefix `./` /
 * `../`, or a known file extension), or `null` for a token that is NOT a file
 * reference: a bare handle (a mention candidate) or an absolute path
 * (`@/abs/x`, skipped to mirror `core/markdown-link`'s leading-`/` ambiguity
 * handling). Callers: `at-file` emits a `references` link when non-null;
 * `at-directive` treats non-null as "file-shaped, skip, at-file owns it".
 */
export function classifyAtFileToken(bare: string): string | null {
  if (bare.startsWith('/')) return null;
  if (bare.startsWith('./') || bare.startsWith('../')) return 'relative path prefix';
  if (FILE_EXT_RE.test(bare)) return 'known file extension';
  return null;
}

/**
 * Resolve a file-shaped `@`-token (the token minus the leading `@`) against
 * the source node's POSIX dirname, producing the canonical root-relative
 * `Node.path`. Mirrors `core/markdown-link`'s resolution so `[x](./y)` and
 * `@./y` from the same source collapse into one edge.
 */
export function resolveAtFileTarget(sourceDir: string, bare: string): string {
  const joined = sourceDir === '.' ? bare : `${sourceDir}/${bare}`;
  return pathPosix.normalize(joined);
}
