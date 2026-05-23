/**
 * User-facing strings emitted by the `signal-collision` built-in rule
 * (`plugins/core/analyzers/signal-collision/index.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const SIGNAL_COLLISION_TEXTS = {
  /**
   * Per-Signal warn issue: two extractors detected something at
   * overlapping byte ranges within the same node and the resolver
   * dropped the loser. Surfaces WHO lost, WHO won, and the tiebreak
   * reason so the operator can understand why a candidate edge did NOT
   * become a Link.
   *
   * Placeholders are deliberately verbose because this is one of the
   * few diagnostic surfaces where the operator may need to disambiguate
   * a confusing graph (e.g. a `[link](path)` followed by `@path` inside
   * the same paragraph, the markdown-link wins and the at-directive
   * silently disappears without this warning).
   */
  message:
    '{{loserExtractor}} detected `{{loserRaw}}` at offset {{loserRange}} but {{winnerExtractor}}\'s detection at {{winnerRange}} won the overlap collision ({{reason}}). The graph shows the winning edge only; the loser is not persisted.',

  /**
   * Same warn but for the rare case the resolver rejected a Signal
   * because the operator disabled its extractor via
   * `plugins.<id>.extensions.<extId>.enabled`. Phase 4+ stub: today the
   * filter is not wired so this template is unreachable from the
   * resolver; documented now so the analyzer stays forward-compatible
   * with the upcoming filter pass.
   */
  messageExtractorDisabled:
    'Extension `{{extractorId}}` is disabled; its detection `{{loserRaw}}` (offset {{loserRange}}) did not produce a Link. Re-enable the extension in Settings or via `sm plugins enable` to surface its edges.',

  /**
   * Same warn but for the future confidence floor case. Phase 4+ stub:
   * today the resolver materialises every winning candidate regardless
   * of confidence, so this template is unreachable; documented for
   * forward compatibility.
   */
  messageBelowFloor:
    'Detection `{{loserRaw}}` (offset {{loserRange}}, confidence {{confidence}}) fell below the configured threshold {{threshold}} and was dropped.',
} as const;
