/**
 * Backtick-dollar extractor (Codex). Scans the node body's CODE REGIONS
 * (inline backtick spans + fenced blocks) for `$<skill>` tokens and
 * emits an `invokes` link candidate per distinct skill, tagged with the
 * code-region `Signal.context`. Normative contract:
 * `spec/architecture.md` §Extractor · code-region triggers.
 *
 * The code-region sibling of `codex/dollar-skill`, completing the
 * per-provider trigger family (`claude/backtick-mention` for `@`,
 * `core/backtick-slash` for `/`): authors routinely wrap an invocation
 * in backticks as stylistic highlighting (``run `$deploy-site` before
 * shipping``) and the consuming LLM follows it like the unwrapped form.
 * But code regions are where shell text lives, and lowercase shell
 * variables (`$file`, `$name`) share the grammar, so the emission is a
 * HYPOTHESIS: the post-walk `prune-unresolved-code-triggers` transform
 * removes any resulting `invokes` link that resolves to no node and has
 * only code-region occurrences. A token naming a real skill becomes an
 * edge; shell payload silently drops, never flagging
 * `core/reference-broken`. (Uppercase env vars `$PATH` / `$HOME` and
 * currency `$5` never even match: the shared grammar requires a
 * lowercase first letter.)
 *
 * Shares the `$`-token grammar with the prose extractor via
 * `kernel/util/dollar-token.ts` (single source, no drift), and the same
 * lens gate: codex-only, since `$` is OpenAI Codex's skill-invocation
 * sigil (its `/` is reserved for built-ins).
 */

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { extractCodeRegions, extractFencedRegions } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { normalizeTrigger } from '../../../../kernel/trigger-normalize.js';
import { DOLLAR_TOKEN_RE } from '../../../../kernel/util/dollar-token.js';
import { CODEX_PLUGIN_ID } from '../../../ids.js';

const ID = 'backtick-dollar';

export const backtickDollarExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CODEX_PLUGIN_ID,
  kind: 'extractor',
  description:
    'Detects `$skill` invocations written inside code spans and fenced blocks and links them to the resolved Codex skill when it exists. Example: a backticked `$check-links` draws an arrow to the check-links skill; unresolved tokens like shell variables are dropped.',
  scope: 'body',
  // Codex-only, mirroring `codex/dollar-skill`: `$skill` is OpenAI
  // Codex's explicit skill-invocation grammar; other lenses do not
  // parse `$`.
  precondition: { provider: ['codex'] },

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

    for (const match of body.matchAll(DOLLAR_TOKEN_RE)) {
      const original = match[1]!;
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
            // 0.8: same value as the prose dollar. The lowercase-letter
            // guard filters currency / env-var noise; the resolution
            // gate, not the confidence, separates a real invocation
            // from shell payload.
            confidence: 0.8,
            rationale: '$skill syntax inside a code region',
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
