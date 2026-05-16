---
'@skill-map/cli': minor
---

Align `core/slash` and `core/at-directive` with how LLM hosts (Claude
Code, Gemini CLI, Cursor) read author-intent tokens in prose. An
external tester surfaced false-positive broken-ref issues on inputs
like `re-invoke @sm-tutorial.md from /Volumes/foo/...`; cross-runtime
research confirmed a consistent pattern across providers and reference
runtimes (Codex, Cursor, Aider).

**New helper `src/kernel/util/strip-code-blocks.ts`:**

- Blanks fenced (` ``` `, `~~~`) and inline (backtick) code regions
  with whitespace of equal length, preserving line counts and byte
  offsets so position-reporting downstream stays aligned.
- Fenced blocks are detected line-wise with the standard commonmark
  rules (≤ 3-space indent, matching fence character + length to
  close). Inline spans support 1-, 2- and 3-tick runs.
- Used by both `slash` and `at-directive`; future body-scope
  extractors get the same treatment for free.

**`core/slash`:**

- Pipes the body through `stripCodeBlocks` before matching, so
  ``` `/scan` ``` in inline code no longer emits a link.
- Adds a TS-side post-match guard: if the character immediately after
  a `/<token>` capture is in `[A-Za-z0-9_/-]`, the token is treated
  as a path segment and dropped. A regex-level lookahead was tried
  first but defeated by the greedy `[a-z0-9_-]*` backtracking
  (`/api/v1/items` matched `/a` with the lookahead passing on `p`).
  The TS guard runs against the original char after the full match.
- Effect: `/Volumes/macintoshexterno/Developer`, `/api/v1/items`,
  `/cmd-foo` extended into a longer path no longer emit broken-ref
  `invokes` links.

**`core/at-directive`:**

- Pipes the body through `stripCodeBlocks` first.
- Replaces the single-kind emission with LLM-aligned link-kind
  dispatch:
  - `@<bare-handle>` and `@<scope>/<name>` (no extension) stay
    `mentions`, preserving the skill-map-native namespaced-handle
    convention.
  - `@<...>.{md|mdx|js|jsx|ts|tsx|json|yml|yaml|toml|txt|html|css|
    scss|less|py|rb|go|rs|java|c|cpp|h|hpp|sh|sql|svg|png|jpg|jpeg|
    gif|webp|pdf}` becomes a `references` link with `target` stripped
    of the leading `./`, matching how `markdown-link` resolves paths
    so dedup carries across both syntaxes.
  - `@./<...>`, `@../<...>`, `@/<...>` are explicit path shapes and
    also become `references`. Mirrors Claude Code / Gemini CLI file-
    reference recognition.
- Token grammar tightened so trailing sentence punctuation (`@foo.`)
  and path separators without leaf (`@dir/`) are not captured.
- Per-kind dedup (`seenMentions`, `seenReferences`), so a body
  mentioning both `@foo` and `@foo.md` emits two distinct links.

**Tests (`src/plugins/core/extractors/__tests__/extractors.spec.ts`):**

- New cases per the reporter's findings: absolute filesystem paths
  drop, `@file.md` lands as `references`, fenced + inline code is
  silenced for both extractors.
- New `cross-provider invariance (claude / gemini / agent-skills)`
  describe block: loops over the three providers with the same
  prose body and asserts the same set of 5 links lands regardless
  of which Provider classified the host node. Documents the
  invariant that `core/` extractors are agnostic to provider
  metadata.
- `stripCodeBlocks` covered by its own spec
  (`src/kernel/util/__tests__/strip-code-blocks.spec.ts`).

## User-facing

**Cleaner scans on prose with file paths and `@file` refs.** `/Volumes/foo` no longer emits a broken-ref, `@file.md` lands as a `references` link (was `mentions`), and tokens inside code blocks are skipped. Re-run `sm scan` to refresh counts.
