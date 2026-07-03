/**
 * Shared `$`-token grammar for the dollar-aware body extractors. Single
 * source of truth so the two consumers never drift (mirrors
 * `at-token.ts` / `slash-token.ts`, which play the same role for the
 * `@` and `/` grammars):
 *
 *   - `codex/dollar-skill` (prose side, codex lens): a `$<skill>` token
 *     in prose becomes an `invokes` link, OpenAI Codex's explicit
 *     skill-invocation grammar (the analog of claude's `/command`).
 *   - `codex/backtick-dollar` (code-region side, same lens): the same
 *     grammar recovered from backtick spans / fenced blocks, emitted as
 *     a resolution-gated hypothesis (see `spec/architecture.md`
 *     §Extractor · code-region triggers).
 *
 * Grammar: the token starts with a standalone `$` (negative lookbehind
 * excludes a word char or another `$`, so `foo$bar` and `$$` never
 * match), the first post-`$` char MUST be a lowercase letter and the
 * tail is `[a-z0-9_-]*`. The `$` sigil collides with shell/env tokens
 * and currency; requiring a lowercase letter drops `$5` / `$100`
 * (currency) and `$PATH` / `$HOME` (uppercase env vars). Open-standard
 * skill handles are lowercase kebab, so this loses nothing real. No
 * `:namespace` tail: the open `.agents/skills/` standard has no plugin
 * namespacing. No `i` flag: the lowercase-letter requirement IS the
 * env / currency guard.
 */
export const DOLLAR_TOKEN_RE = /(?<![A-Za-z0-9_$])(\$[a-z][a-z0-9_-]*)/g;
