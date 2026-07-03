/**
 * At-directive extractor (Claude). Scans the node body for `@<token>` tokens
 * and emits a `mentions` link for each distinct BARE handle (`@team`,
 * `@my-plugin/foo`): a reference to a named entity, the grammar Claude Code
 * uses for `@`-mentions.
 *
 * File-shaped tokens (`@foo.md`, `@./x`, `@../x`) are NOT handled here: the
 * shared `core/at-file` extractor turns them into `references` links
 * (path-resolved). This extractor defers to it via `classifyAtFileToken`, so
 * the same `@token` never doubles as a mention AND a reference. Absolute
 * `@/abs/x` is skipped entirely (neither a mention nor a reference, mirroring
 * `core/markdown-link`'s leading-`/` ambiguity handling).
 *
 * Claude-only: a bare `@handle` reads as an agent / entity MENTION only under
 * Claude. Codex and Antigravity read `@` purely as a file picker (no
 * bare-handle mentions), so they run `core/at-file` and NOT this extractor.
 *
 * Matching rules:
 * - Token must start with a standalone `@` (SOL or non-word prefix) so emails
 *   (`foo@bar.com`) and `@@` don't match.
 * - Tokens inside fenced code blocks, inline backticks, or raw HTML (comments
 *   / tags) are skipped HERE (`stripCodeAndHtml`); the code-region half
 *   (spans + fences, not HTML) belongs to the sibling
 *   `claude/backtick-mention`, which emits the same `mentions` shape
 *   gated on resolution (spec/architecture.md §Extractor · code-region
 *   mentions).
 * - The `@`-token grammar is shared with `core/at-file` and
 *   `claude/backtick-mention` via `kernel/util/at-token.ts` (single
 *   source, no drift).
 */

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { stripCodeAndHtml } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { normalizeTrigger } from '../../../../kernel/trigger-normalize.js';
import { AT_TOKEN_RE, classifyAtFileToken } from '../../../../kernel/util/at-token.js';
import { CLAUDE_PLUGIN_ID } from '../../../ids.js';

const ID = 'at-directive';

export const atDirectiveExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CLAUDE_PLUGIN_ID,
  kind: 'extractor',
  description: 'Detects bare `@<handle>` mentions in a node\'s body using Claude Code rules and emits a `mentions` link to the named entity. Example: `@team` becomes a `mentions` link. File-shaped tokens like `@docs/api.md` are handled by `core/at-file` instead.',
  scope: 'body',
  // Claude-only. This is Claude's bare `@<handle>` MENTION grammar. The
  // file-reference half of `@` (file-shaped tokens) is the shared
  // `core/at-file` extractor, which also serves codex / antigravity; this
  // extractor defers file-shaped tokens to it.
  precondition: { provider: ['claude'] },

  extract(ctx: IExtractorContext): void {
    const seenMentions = new Set<string>();
    const body = stripCodeAndHtml(ctx.body);
    const lineStarts = computeLineStarts(body);

    for (const match of body.matchAll(AT_TOKEN_RE)) {
      const original = match[1]!;
      const bare = original.slice(1); // drop the leading `@`
      // Absolute path (`@/abs/x`): neither a mention nor a reference, skip
      // (mirrors `core/markdown-link`'s leading-`/` ambiguity handling).
      if (bare.startsWith('/')) continue;
      // File-shaped (`@foo.md`, `@./x`, `@../x`): `core/at-file` owns it, skip
      // here so the same `@token` never doubles as a mention AND a reference.
      if (classifyAtFileToken(bare) !== null) continue;

      // Bare handle → a `mentions` link.
      const normalized = normalizeTrigger(original);
      if (seenMentions.has(normalized)) continue;
      seenMentions.add(normalized);
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
            kind: 'mentions',
            target: original,
            // 0.5: genuine ambiguity. A bare `@handle` (no extension, no path
            // prefix) could be an agent, a handle, or generic prose. The
            // runtime decides at invocation time; the extractor leaves it open.
            confidence: 0.5,
            rationale: 'no extension, no path prefix',
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
