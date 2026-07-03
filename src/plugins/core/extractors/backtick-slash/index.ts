/**
 * Backtick-slash extractor. Scans the node body's CODE REGIONS (inline
 * backtick spans + fenced blocks) for `/<command>` tokens and emits an
 * `invokes` link candidate per distinct command, tagged with the
 * code-region `Signal.context`. Normative contract:
 * `spec/architecture.md` §Extractor · code-region triggers.
 *
 * The code-region sibling of `core/slash-command`, exactly as
 * `claude/backtick-mention` is the sibling of `claude/at-directive`:
 * authors routinely wrap an invocation in backticks as stylistic
 * highlighting (``run `/deploy` before shipping``) and the consuming
 * LLM follows it like the unwrapped form. But code regions are full of
 * slash-shaped payload (shell paths like `/tmp`, CLI output, URL
 * fragments), so the emission is a HYPOTHESIS: the post-walk
 * `prune-unresolved-code-triggers` transform removes any resulting
 * `invokes` link that resolves to no node and has only code-region
 * occurrences. A token naming a real command / skill / workflow becomes
 * an edge; payload silently drops, never flagging
 * `core/reference-broken`.
 *
 * Shares the `/`-token grammar (regex + post-match path guard) with
 * the prose extractor via `kernel/util/slash-token.ts` (single source,
 * no drift), and the same lens gate: claude / antigravity / opencode
 * all invoke by `/<name>`; codex reserves `/` for its own built-ins
 * and invokes skills with `$`.
 */

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { extractCodeRegions, extractFencedRegions } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { normalizeTrigger } from '../../../../kernel/trigger-normalize.js';
import { SLASH_TOKEN_RE, isPathLikeSuffix } from '../../../../kernel/util/slash-token.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'backtick-slash';

export const backtickSlashExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'extractor',
  description:
    'Detects `/command` invocations written inside code spans and fenced blocks and links them to the resolved slash command, skill, or workflow when it exists. Example: a backticked `/deploy` draws an arrow to the deploy command; unresolved tokens like shell paths are dropped.',
  scope: 'body',
  // Same lens gate as the prose `core/slash-command`: the `/` grammar
  // belongs to claude / antigravity / opencode. NOT codex (its `/` is
  // reserved for built-ins; user skills go through `$`).
  precondition: { provider: ['claude', 'antigravity', 'opencode'] },

  extract(ctx: IExtractorContext): void {
    const seen = new Set<string>();
    // The inverse mask keeps ONLY code-region characters (same length,
    // newlines preserved), so offsets and line numbers computed against
    // the mask are valid against the original body. The fenced-only
    // mask classifies each match: fence hit = 'code-block', otherwise
    // the match sits in an inline span.
    const body = extractCodeRegions(ctx.body);
    const fenced = extractFencedRegions(ctx.body);
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
        // The gate's provenance: the resolver copies this onto the
        // materialised link's occurrence, and the post-walk transform
        // prunes unresolved all-code-region triggers.
        context: fenced[captureOffset] === ' ' ? 'inline-code' : 'code-block',
        candidates: [
          {
            extractorId: ID,
            kind: 'invokes',
            target: original,
            // 0.8: same value as the prose slash. The path guard filters
            // path noise, so a hit is unambiguous syntax; the resolution
            // gate, not the confidence, separates a real invocation from
            // code payload.
            confidence: 0.8,
            rationale: 'slash syntax inside a code region',
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
