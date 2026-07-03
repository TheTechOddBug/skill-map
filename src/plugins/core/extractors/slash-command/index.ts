/**
 * Slash extractor. Scans the node body for `/<command>` tokens and emits
 * one `invokes` link per distinct invocation. Deduplicates by trigger so
 * a body mentioning `/deploy` three times produces a single link.
 *
 * Matching rules:
 *
 * - **Code regions and raw HTML are stripped first** (`stripCodeAndHtml`).
 *   Fenced blocks, inline code spans, and HTML (comments / tags) are
 *   author-marked literal payload, not invocation surface; Claude Code /
 *   Antigravity CLI / Cursor all read them the same way. Without this
 *   guard a paragraph like "run
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
 * - The `/`-token grammar (regex + post-match path guard) is shared
 *   with the code-region sibling `core/backtick-slash` via
 *   `kernel/util/slash-token.ts` (single source, no drift).
 *
 * Target resolution is left to the rules layer: the extractor emits
 * `target: <command>` as a bare name, and `reference-broken` marks it invalid
 * if no node in the scan advertises that trigger.
 */

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { stripCodeAndHtml } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { normalizeTrigger } from '../../../../kernel/trigger-normalize.js';
import { SLASH_TOKEN_RE, isPathLikeSuffix } from '../../../../kernel/util/slash-token.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'slash-command';

export const slashCommandExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'extractor',
  description: 'Turns `/command` invocations in a node\'s body into arrows that point at the resolved slash command, skill, or workflow, using the `/`-grammar shared by Claude, Antigravity, and OpenCode. Example: `/deploy` in the body draws an arrow to the `deploy` command.',
  scope: 'body',
  // Also authorised under the antigravity lens, which shares the `/command`
  // grammar: a workflow / skill / AGENTS.md body's `/name` tokens resolve to
  // BOTH skills and workflows (`invokes: ['skill', 'workflow']`), since
  // Antigravity invokes either by the same slash. NOT gated under codex:
  // OpenAI Codex reserves `/` for its OWN built-in commands (`/model`,
  // `/init`, ...) and invokes user skills with `$` instead (parsed by the
  // codex `dollar-skill` extractor). A lens that declares no `invokes`
  // resolution leaves the signals unresolved (no spurious edges).
  //
  // Also authorised under the opencode lens: OpenCode invokes its custom
  // `.opencode/commands/<name>.md` with `/<name>` (the opencode provider maps
  // `invokes: ['command']`, since OpenCode loads skills via its native `skill`
  // tool rather than the slash channel). Additive: claude / antigravity runs
  // are unchanged.
  precondition: { provider: ['claude', 'antigravity', 'opencode'] },

  extract(ctx: IExtractorContext): void {
    const seen = new Set<string>();
    const body = stripCodeAndHtml(ctx.body);
    const lineStarts = computeLineStarts(body);

    for (const match of body.matchAll(SLASH_TOKEN_RE)) {
      const original = match[1]!;
      // Post-match path guard (see `kernel/util/slash-token.ts`): a
      // token whose suffix extends into more path (`/api/v1/items`,
      // `/Volumes/Disk`) is a path segment, not a command.
      const endIdx = (match.index ?? 0) + match[0].length;
      if (isPathLikeSuffix(body, endIdx)) continue;

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
