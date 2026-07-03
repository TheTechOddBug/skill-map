/**
 * Dollar-skill extractor (Codex). Scans a node body for `$<skill>` tokens
 * and emits one `invokes` link per distinct invocation, deduplicated by
 * trigger. This is Codex's skill-invocation grammar: OpenAI Codex invokes
 * an installed skill explicitly with `$skill-name` (see
 * https://developers.openai.com/codex/skills), the analog of claude's
 * `/command`. Codex's `/` is reserved for its OWN built-in commands
 * (`/model`, `/init`, ...), so the `slash-command` extractor is NOT gated
 * under the codex lens; `$` is.
 *
 * Matching rules:
 *
 * - **Code regions and raw HTML are stripped first** (`stripCodeAndHtml`),
 *   so a fenced/backticked `$skill` is treated as literal payload, not an
 *   invocation (same guard the slash / at-directive extractors apply).
 * - The token starts with a standalone `$` (negative lookbehind excludes
 *   a word char or another `$`, so `foo$bar` and `$$` never match).
 * - The first post-`$` char MUST be a lowercase letter and the tail is
 *   `[a-z0-9_-]*`. The `$` sigil collides with shell/env tokens and
 *   currency; requiring a lowercase letter drops `$5` / `$100` (currency)
 *   and `$PATH` / `$HOME` (uppercase env vars). Open-standard skill handles
 *   are lowercase kebab, so this loses nothing real. No `:namespace` tail:
 *   the open `.agents/skills/` standard has no plugin namespacing.
 *
 * Target resolution is left to the rules layer: the extractor emits
 * `target: $<skill>` and the resolver name-matches it (sigil-stripped)
 * against the `.agents/skills/` skill catalog via codex's
 * `resolution.invokes: ['skill']`; `reference-broken` marks it invalid if
 * no skill advertises that handle.
 *
 * The `$`-token grammar is shared with the code-region sibling
 * `codex/backtick-dollar` via `kernel/util/dollar-token.ts` (single
 * source, no drift).
 */

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { stripCodeAndHtml } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { normalizeTrigger } from '../../../../kernel/trigger-normalize.js';
import { DOLLAR_TOKEN_RE } from '../../../../kernel/util/dollar-token.js';
import { CODEX_PLUGIN_ID } from '../../../ids.js';

const ID = 'dollar-skill';

export const dollarSkillExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CODEX_PLUGIN_ID,
  kind: 'extractor',
  description: 'Turns `$skill` invocations in a node\'s body into arrows that point at the resolved Codex skill, using OpenAI Codex routing rules. Example: `$check-links` in the body draws an arrow to the `check-links` skill.',
  scope: 'body',
  // Codex-only: `$skill` is OpenAI Codex's explicit skill-invocation
  // grammar. The codex provider resolves it to its open-standard skills
  // (`invokes: ['skill']`). Other lenses do not parse `$`.
  precondition: { provider: ['codex'] },

  extract(ctx: IExtractorContext): void {
    const seen = new Set<string>();
    const body = stripCodeAndHtml(ctx.body);
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
        candidates: [
          {
            extractorId: ID,
            kind: 'invokes',
            target: original,
            // 0.8: clean `$skill` match after code-block strip. The
            // lowercase-letter guard filters currency / env-var noise, so a
            // hit is unambiguous syntax. Resolution against the live skill
            // catalog happens downstream.
            confidence: 0.8,
            rationale: 'unambiguous $skill syntax post code-block strip',
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
