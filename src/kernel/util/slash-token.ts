/**
 * Shared `/`-token grammar for the slash-aware body extractors. Single
 * source of truth so the two consumers never drift (mirrors
 * `at-token.ts`, which plays the same role for the `@` grammar):
 *
 *   - `core/slash-command` (prose side, lenses claude / antigravity /
 *     opencode): a `/<command>` token in prose becomes an `invokes`
 *     link.
 *   - `core/backtick-slash` (code-region side, same lenses): the same
 *     grammar recovered from backtick spans / fenced blocks, emitted as
 *     a resolution-gated hypothesis (see `spec/architecture.md`
 *     §Extractor · code-region triggers).
 *
 * The `/` grammar is NOT universal markdown (only the runtimes above
 * read `/` as an invocation), so neither consumer is a universal `core`
 * extractor in the gating sense: both are lens-gated via
 * `precondition.provider`. The grammar itself is shared, hence this
 * neutral kernel util.
 */

/**
 * Match `/command` only when the preceding character is NOT one that
 * would make the `/` part of a URL, file path, or markdown relative
 * link. Negative lookbehind enumerates the disallowed predecessors:
 *
 *   - `A-Za-z0-9_`, mid-word (`foo/bar` shouldn't match `/bar`).
 *   - `/`          , `//` shouldn't match.
 *   - `.`          , `./foo`, `../foo`, `domain.com/path`. This is
 *                     the "markdown relative link" footgun: `[link](./
 *                     file.md)` was extracting `/file` and producing a
 *                     broken-ref link to a non-existent command.
 *   - `:`          , `https://foo`, `c:/Win`. URL schemes / drive letters.
 *   - `?` `#`      , query strings and fragments inside URLs.
 *   - `=` `&`      , query-string value separators (`?q=/foo&r=/bar`).
 *                     Without these, `?q=/algo` would match `/algo`
 *                     because the immediate predecessor `=` was not
 *                     in the negative list.
 *
 * Command identifier: one or more of `[a-z0-9_-]` starting alphanumeric,
 * containing AT LEAST ONE LETTER, optionally followed by a namespace
 * separator `:` + another identifier under the same letter rule (Claude
 * Code plugin namespace convention, e.g. `/skill-map:explore`).
 * Case-insensitive; capture group 1 is the `/`-token.
 *
 * The letter requirement (the `(?=[0-9_-]*[a-z])` lookaheads) drops
 * purely numeric tokens: prose like "total /10" or "score 8/10 on a
 * new line" is a fraction / denominator, not an invocation, and every
 * such match surfaced as a red `reference-broken` false positive (field
 * report 2026-08-10). No real command is all digits, command names come
 * from file basenames, so this loses nothing; digit-LEADING names
 * (`/2fa-setup`) keep matching. Mirrors `dollar-token.ts`, whose
 * grammar already rejects `$5` / `$100` for the same reason (currency),
 * and `at-token.ts` carries the same guard, the three sigil grammars
 * are swept as a set (runtime-quirks §8).
 *
 * We DO NOT use a regex-level negative lookahead for the "next char is
 * `/`" check: the engine's backtracking lets `/api/v1/items` match `/a`
 * (greedy `[a-z0-9_-]*` shrinks to zero, lookahead then passes because
 * the next char is `p`, not `/`). Callers run `isPathLikeSuffix` on the
 * original text instead. The letter lookaheads above are safe from that
 * failure mode: they sit at fixed positions (right after `/` and `:`)
 * and assert over a prefix the following atoms re-consume, so
 * backtracking cannot shrink them into vacuity.
 */
export const SLASH_TOKEN_RE =
  /(?<![A-Za-z0-9_/.:?#=&])(\/(?=[0-9_-]*[a-z])[a-z0-9][a-z0-9_-]*(?::(?=[0-9_-]*[a-z])[a-z0-9][a-z0-9_-]*)?)/gi;

/**
 * Post-match path guard: `true` when the char at `endIdx` (immediately
 * after the full match) is another identifier-or-slash char, which
 * means the token is actually a path segment (`/api/v1/items`,
 * `/Volumes/Disk`, `/cmd-foo` where the foo extends), not a command.
 * Done in TS because a regex-level lookahead is defeated by
 * backtracking on the greedy `[a-z0-9_-]*`. Same idea every LLM
 * applies: a `/` token followed by more path is a path, not a command.
 */
export function isPathLikeSuffix(body: string, endIdx: number): boolean {
  const nextChar = body[endIdx];
  return Boolean(nextChar && /[A-Za-z0-9_/-]/.test(nextChar));
}
