/**
 * Backtick-mention extractor (Claude). Scans the node body's CODE
 * REGIONS (inline backtick spans + fenced blocks) for bare `@<handle>`
 * tokens and emits a `mentions` link candidate for each distinct
 * handle, tagged with the code-region `Signal.context`. Normative
 * contract: `spec/architecture.md` §Extractor · code-region triggers.
 *
 * The second sanctioned inversion of the code-strip policy (the first
 * is `core/backtick-path`): authors routinely wrap an entity mention in
 * backticks as stylistic highlighting (``use `@reviewer` for the final
 * pass``), and the consuming LLM follows it exactly like the unwrapped
 * form. But the base rate of `@` tokens inside code regions is the
 * OPPOSITE of the file-path case, dominated by non-mention payload
 * (npm scopes `@changesets/cli`, decorators `@Injectable`, CSS
 * at-rules `@media`). So the emission is a HYPOTHESIS: the post-walk
 * `prune-unresolved-code-triggers` transform removes any resulting
 * `mentions` link that resolves to no node and has only code-region
 * occurrences. A handle that names a real agent becomes an edge; code
 * payload silently drops, never flagging `core/reference-broken`.
 *
 * Shares everything grammar-shaped with `claude/at-directive` (the
 * prose-side sibling) via `kernel/util/at-token.ts`:
 *   - The `@`-token regex (single source, no drift).
 *   - The file-shape deferral: `@foo.md` / `@./x` / `@../x` are NOT
 *     mentions (for `.md` targets the path half already surfaces as a
 *     `points` edge via `core/backtick-path`); absolute `@/abs/x` is
 *     skipped entirely.
 *   - Kind (`mentions`), confidence (0.5, genuine ambiguity), and
 *     trigger normalization, so a prose `@x` and a backticked `@x`
 *     from the same body dedupe into ONE link with unioned sources.
 *
 * Claude-only, like `at-directive`: a bare `@handle` reads as an agent
 * mention only under Claude; codex / antigravity read `@` purely as a
 * file picker.
 */

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { extractCodeRegions, extractFencedRegions } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { normalizeTrigger } from '../../../../kernel/trigger-normalize.js';
import { AT_TOKEN_RE, classifyAtFileToken } from '../../../../kernel/util/at-token.js';
import { CLAUDE_PLUGIN_ID } from '../../../ids.js';

const ID = 'backtick-mention';

export const backtickMentionExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CLAUDE_PLUGIN_ID,
  kind: 'extractor',
  description:
    'Detects bare `@<handle>` mentions written inside code spans and fenced blocks and links them to the named entity when it exists. Example: a backticked `@reviewer` draws a mention arrow to the reviewer agent; unresolved tokens like npm package names are dropped.',
  scope: 'body',
  // Claude-only, mirroring `claude/at-directive`: the bare-`@handle`
  // mention grammar exists only under the claude lens.
  precondition: { provider: ['claude'] },

  extract(ctx: IExtractorContext): void {
    const seenMentions = new Set<string>();
    // The inverse mask keeps ONLY code-region characters (same length,
    // newlines preserved), so offsets and line numbers computed against
    // the mask are valid against the original body. The fenced-only
    // mask classifies each match: fence hit = 'code-block', otherwise
    // the match sits in an inline span.
    const body = extractCodeRegions(ctx.body);
    const fenced = extractFencedRegions(ctx.body);
    const lineStarts = computeLineStarts(body);

    for (const match of body.matchAll(AT_TOKEN_RE)) {
      const original = match[1]!;
      const bare = original.slice(1); // drop the leading `@`
      // Absolute path (`@/abs/x`): neither a mention nor a reference,
      // skip (same rule as `at-directive`).
      if (bare.startsWith('/')) continue;
      // File-shaped (`@foo.md`, `@./x`, `@../x`): not a mention; the
      // `.md` path half is `core/backtick-path`'s domain in code
      // regions, so skip here to keep the token single-voiced.
      if (classifyAtFileToken(bare) !== null) continue;

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
        // The gate's provenance: the resolver copies this onto the
        // materialised link's occurrence, and the post-walk transform
        // prunes unresolved all-code-region triggers.
        context: fenced[captureOffset] === ' ' ? 'inline-code' : 'code-block',
        candidates: [
          {
            extractorId: ID,
            kind: 'mentions',
            target: original,
            // 0.5: same genuine ambiguity as the prose bare handle. The
            // resolution gate, not the confidence, is what separates a
            // real mention from code payload.
            confidence: 0.5,
            rationale: 'bare handle inside a code region',
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
