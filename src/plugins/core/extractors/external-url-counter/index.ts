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

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import type { IViewContribution, TSettingDeclaration } from '../../../../kernel/types/view-catalog.js';
import { stripCodeBlocks } from '../../../../kernel/util/strip-code-blocks.js';
import { computeLineStarts, lineFor } from '../../../../kernel/util/line-tracking.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'external-url-counter';

const count = {
  slot: 'card.footer.left',
  icon: 'pi-link',
  label: 'urls',
  emitWhenEmpty: false,
  priority: 30,
} satisfies IViewContribution;

const SETTING_IGNORED_DOMAINS = 'ignored-domains';

const settings = {
  [SETTING_IGNORED_DOMAINS]: {
    type: 'string-list',
    label: 'Ignored domains',
    description:
      'Hostnames to exclude from the external-URL count (e.g. internal mirrors, link shorteners).',
    default: [],
  },
} satisfies Record<string, TSettingDeclaration>;

// Greedy match of http(s) URLs. Stops at whitespace and the markdown
// delimiters that commonly wrap URLs: `<`, `>`, `"`, `'`, backtick,
// `)`, `]`. The trailing-punctuation pass below trims sentence enders
// like `.`, `,`, `;`, `:`, `!`, `?` that the regex still picks up.
const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;

const TRAILING_PUNCT = /[.,;:!?]+$/;

export const externalUrlCounterExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'extractor',
  description:
    'Counts the distinct external URLs in a node\'s body and shows the count on the card. Example: a body linking `https://example.com` and `https://docs.rs` shows a count of 2.',
  scope: 'body',

  /**
   * Operator-configurable hostnames to exclude from the count. A URL
   * whose normalized `hostname` is in this list is skipped entirely:
   * no Signal, no contribution increment. Default empty (count every
   * external URL). The operator sets it via
   * `sm plugins config core/external-url-counter ignored-domains '["…"]'`.
   */
  settings,

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
  ui: { count },

  extract(ctx: IExtractorContext): void {
    const seen = new Set<string>();
    // Operator-supplied ignore list (resolved by the kernel settings
    // resolver, already validated to `string[]`). Lowercased once so the
    // per-URL hostname check is case-insensitive and deterministic.
    const ignoredDomains = readIgnoredDomains(ctx.settings[SETTING_IGNORED_DOMAINS]);
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
      // Skip operator-ignored hostnames before dedup / count so an
      // excluded domain never contributes a Signal nor inflates the chip.
      if (ignoredDomains.has(normalized.host)) continue;
      if (seen.has(normalized.href)) continue;
      seen.add(normalized.href);

      const offset = match.index ?? 0;
      const line = lineFor(lineStarts, offset);
      ctx.emitSignal({
        source: ctx.node.path,
        scope: 'body',
        range: { start: offset, end: offset + original.length, line },
        raw: original,
        candidates: [
          {
            extractorId: ID,
            kind: 'references',
            target: normalized.href,
            confidence: 0.3,
            rationale: 'external URL pseudo-link, counted then dropped',
            trigger: {
              originalTrigger: original,
              normalizedTrigger: normalized.href,
            },
          },
        ],
      });
    }

    if (seen.size > 0) {
      ctx.emitContribution(count, { value: seen.size });
    }
  },
};

function stripTrailingPunctuation(raw: string): string {
  return raw.replace(TRAILING_PUNCT, '');
}

/**
 * Coerce the resolved `ignored-domains` setting into a lowercased Set.
 * The kernel resolver already validated it to `string[]`, but the
 * extractor stays defensive (a missing override or a malformed manual
 * config that slipped through degrades to "ignore nothing").
 */
function readIgnoredDomains(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set();
  const out = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0) out.add(entry.toLowerCase());
  }
  return out;
}

function normalizeUrl(raw: string): { href: string; host: string } | null {
  try {
    const url = new URL(raw);
    // URL already lowercases host on parse, but be explicit so future
    // refactors don't regress.
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    return { href: url.href, host: url.hostname };
  } catch {
    return null;
  }
}
