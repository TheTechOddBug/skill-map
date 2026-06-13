/**
 * Slash extractor. Scans the node body for `/<command>` tokens and emits
 * one `invokes` link per distinct invocation. Deduplicates by trigger so
 * a body mentioning `/deploy` three times produces a single link.
 *
 * Matching rules:
 *
 * - **Code regions are stripped first** (`stripCodeBlocks`). Fenced
 *   blocks and inline code spans are author-marked literal payload,
 *   not invocation surface; Claude Code / Antigravity CLI / Cursor all read
 *   them the same way. Without this guard a paragraph like "run
 *   `/scan` first" would emit a `/scan` link even when the author
 *   meant the literal token.
 * - Token must start with a standalone `/` (start-of-line or
 *   non-word char before) so file paths like `src/cli` don't match.
 * - Token must NOT be followed by another `/` (so absolute paths
 *   like `/Volumes/Disk` or URL paths like `/api/v1/items` are
 *   treated as paths, not as a command followed by garbage). This is
 *   the lookahead that tells `@/handle` syntax (mention-style, see
 *   `at-directive`) apart from `/path/segment` syntax (filesystem).
 * - Command identifier is one or more of `[a-z0-9_-]`, optionally
 *   followed by a namespace separator `:` + another identifier
 *   (matches Claude Code plugin namespace convention, e.g.
 *   `/skill-map:explore`).
 * - Case-insensitive match; the original text is preserved verbatim
 *   in `originalTrigger`.
 *
 * Target resolution is left to the rules layer: the extractor emits
 * `target: <command>` as a bare name, and `reference-broken` marks it invalid
 * if no node in the scan advertises that trigger.
 */

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { stripCodeBlocks } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { normalizeTrigger } from '../../../../kernel/trigger-normalize.js';
import { CLAUDE_PLUGIN_ID } from '../../../ids.js';

const ID = 'slash-command';

// Match `/command` only when the preceding character is NOT one that
// would make the `/` part of a URL, file path, or markdown relative
// link. Negative lookbehind enumerates the disallowed predecessors:
//
//   - `A-Za-z0-9_`, mid-word (`foo/bar` shouldn't match `/bar`).
//   - `/`          , `//` shouldn't match.
//   - `.`          , `./foo`, `../foo`, `domain.com/path`. This is
//                     the "markdown relative link" footgun: `[link](./
//                     file.md)` was extracting `/file` and producing a
//                     broken-ref link to a non-existent command.
//   - `:`          , `https://foo`, `c:/Win`. URL schemes / drive letters.
//   - `?` `#`      , query strings and fragments inside URLs.
//   - `=` `&`      , query-string value separators (`?q=/foo&r=/bar`).
//                     Without these, `?q=/algo` would match `/algo`
//                     because the immediate predecessor `=` was not
//                     in the negative list.
//
// JS supports fixed-width negative lookbehind in V8 since 2018, safe
// in all our targets (Node 24 / current evergreen browsers).
//
// We DO NOT use a regex-level negative lookahead for the "next char
// is `/`" check: the engine's backtracking lets `/api/v1/items` match
// `/a` (greedy `[a-z0-9_-]*` shrinks to zero, lookahead then passes
// because the next char is `p`, not `/`). The path-suffix guard runs
// post-match in TS instead, against the original char immediately
// after the full match (see `extract()` below). Same idea every
// LLM applies: a `/` token followed by more path is a path, not a
// command.
const SLASH_RE = /(?<![A-Za-z0-9_/.:?#=&])(\/[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?)/gi;

export const slashCommandExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CLAUDE_PLUGIN_ID,
  kind: 'extractor',
  description: 'Turns `/command` invocations in a node\'s body into arrows that point at the resolved slash command or skill, using Claude Code routing rules. Example: `/deploy` in the body draws an arrow to the `deploy` command.',
  scope: 'body',
  precondition: { provider: ['claude'] },

  extract(ctx: IExtractorContext): void {
    const seen = new Set<string>();
    const body = stripCodeBlocks(ctx.body);
    const lineStarts = computeLineStarts(body);

    for (const match of body.matchAll(SLASH_RE)) {
      const original = match[1]!;
      // Post-match path guard: if the char IMMEDIATELY after the full
      // capture is another identifier-or-slash char, the token is
      // actually a path segment (`/api/v1/items`, `/Volumes/Disk`,
      // `/cmd-foo` where the foo extends), not a command. Done in TS
      // because a regex-level lookahead is defeated by backtracking
      // on the greedy `[a-z0-9_-]*`.
      const endIdx = (match.index ?? 0) + match[0].length;
      const nextChar = body[endIdx];
      if (nextChar && /[A-Za-z0-9_/-]/.test(nextChar)) continue;

      const normalized = normalizeTrigger(original);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const captureOffset = (match.index ?? 0) + match[0].indexOf(original);
      const line = lineFor(lineStarts, captureOffset);
      ctx.emitSignal({
        source: ctx.node.path,
        scope: 'body',
        range: { start: captureOffset, end: captureOffset + original.length, line },
        raw: original,
        candidates: [
          {
            extractorId: ID,
            kind: 'invokes',
            target: original,
            // 0.8: clean `/command` match after code-block strip. The
            // post-match path guard above filters URL / file-path noise,
            // so a hit is unambiguous syntax. Resolution against the
            // live skill / command catalog happens downstream.
            confidence: 0.8,
            rationale: 'unambiguous slash syntax post code-block strip',
            trigger: {
              originalTrigger: original,
              normalizedTrigger: normalized,
            },
          },
        ],
      });
    }
  },
};
