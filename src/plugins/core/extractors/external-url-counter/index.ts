/**
 * External URL counter extractor. Scans the node body for `http://` and
 * `https://` URLs and emits one "pseudo-link" per distinct normalized URL.
 *
 * The pseudo-links are the on-the-wire transport for a count: the
 * orchestrator partitions them out of `result.links` (any link whose
 * target starts with `http://` or `https://`), increments
 * `node.externalRefsCount` per source, then DROPS them. They are never
 * persisted to `scan_links` and never reach the rules layer.
 *
 * Design constraint: the spec's `link.kind` enum is locked to
 * `invokes / references / mentions / supersedes`. We reuse `references`
 * (closest semantic match, a URL IS a reference, just to something
 * outside the graph) at low confidence to avoid bumping the spec for a
 * counter that the orchestrator strips before serialising.
 *
 * URL normalization rules (cheap, deterministic):
 *   1. `new URL(raw)`, bad URLs are silently dropped.
 *   2. Lowercase the host (RFC 3986 case-insensitive).
 *   3. Drop the fragment (`#a` and `#b` count as the same external ref).
 *   4. Preserve scheme, port, path, query verbatim.
 *   5. Dedup key is the resulting `url.href`.
 *
 * Per-node dedup: the first occurrence of a normalized URL wins; later
 * duplicates within the same body are skipped.
 *
 * The trigger-normalize util in `kernel/trigger-normalize.ts` is for
 * human-typed slash / at-directive triggers, NOT URLs, it would mangle
 * paths and queries. We roll our own URL normalization here.
 */

import type { IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import type { Link } from '../../../../kernel/types.js';
import { stripCodeBlocks } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';

const ID = 'external-url-counter';

// Greedy match of http(s) URLs. Stops at whitespace and the markdown
// delimiters that commonly wrap URLs: `<`, `>`, `"`, `'`, backtick,
// `)`, `]`. The trailing-punctuation pass below trims sentence enders
// like `.`, `,`, `;`, `:`, `!`, `?` that the regex still picks up.
const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;

const TRAILING_PUNCT = /[.,;:!?]+$/;

export const externalUrlCounterExtractor: IExtractor = {
  id: ID,
  pluginId: 'core',
  kind: 'extractor',
  version: '1.0.0',
  description:
    'Counts the distinct external URLs in a node\'s body and shows the total on the card.',
  scope: 'body',

  /**
   * Phase 6 / View contribution system, surface the distinct-URL
   * count as a card-footer-left chip alongside the in/out link
   * counters and the tools-count wrench. The chip is silent when
   * zero URLs were emitted (`emitWhenEmpty: false`), so unrelated
   * nodes do not gain a `link 0` decoration. The counter rides on
   * exactly the same data the orchestrator was already going to
   * count, there is no second pass.
   *
   * Icon is the PrimeIcons `pi-link` glyph (declared as the bare
   * `'link'` per `IconString` rules in `view-slots.schema.json`).
   * Mirrors the look of the legacy hardcoded `pi pi-link` chip in
   * `node-card.html` it replaced, same icon font, same sizing
   * inherited from the footer `.sm-gnode__stat` styles cloned by
   * the `NodeCounter` renderer.
   */
  ui: {
    count: {
      slot: 'card.footer.left',
      icon: 'pi-link',
      label: 'urls',
      emitWhenEmpty: false,
      priority: 30,
    },
  },

  extract(ctx: IExtractorContext): void {
    const seen = new Set<string>();
    // Strip fenced blocks and inline code spans before matching so a
    // URL written for documentation purposes (e.g. ``http://example.com``
    // inside a README table) does NOT inflate the external-ref count.
    // Mirrors the same guard `markdown-link`, `at-directive`, and
    // `slash` already apply, see those extractors' headers for the
    // shared rationale. `stripCodeBlocks` replaces code regions with
    // same-length whitespace so the `lineFor` mapping below stays
    // accurate.
    const body = stripCodeBlocks(ctx.body);
    const lineStarts = computeLineStarts(body);

    for (const match of body.matchAll(URL_RE)) {
      const original = stripTrailingPunctuation(match[0]);
      if (original.length === 0) continue;

      const normalized = normalizeUrl(original);
      if (normalized === null) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const offset = match.index ?? 0;
      const link: Link = {
        source: ctx.node.path,
        target: normalized,
        kind: 'references',
        confidence: 0.3,
        sources: [ID],
        trigger: {
          originalTrigger: original,
          normalizedTrigger: normalized,
        },
        location: { line: lineFor(lineStarts, offset) },
      };
      ctx.emitLink(link);
    }

    if (seen.size > 0) {
      ctx.emitContribution('count', { value: seen.size });
    }
  },
};

function stripTrailingPunctuation(raw: string): string {
  return raw.replace(TRAILING_PUNCT, '');
}

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    // URL already lowercases host on parse, but be explicit so future
    // refactors don't regress.
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
