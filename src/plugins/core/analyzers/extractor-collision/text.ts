/**
 * User-facing strings emitted by the `extractor-collision` built-in rule
 * (`plugins/core/analyzers/extractor-collision/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const EXTRACTOR_COLLISION_TEXTS = {
  /**
   * Per-Signal warn issue: two extractors detected something at
   * overlapping byte ranges within the same node and the resolver
   * dropped the loser. Surfaces WHO lost, WHO won, and the tiebreak
   * reason so the operator can understand why a candidate edge did NOT
   * become a Link (e.g. a `[link](path)` with `@path` inside the bracket
   * text: markdown-link wins and the at-directive silently disappears
   * without this warning).
   */
  message:
    'Overlap collision; {{loserExtractor}} (at {{loserRange}}) lost to {{winnerExtractor}} (at {{winnerRange}}) by {{reason}}, only the winning edge persists',
  /**
   * Remediation hint for the range-overlap rejection, surfaced via
   * `Issue.fix.summary`. Not autofixable: the rule cannot tell which
   * detection the author meant, so it offers the two resolutions
   * (rephrase one token, or accept the winner).
   */
  rejectedFixSummary: 'Rephrase one of the overlapping tokens, or accept the winner.',
} as const;
