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
    'Overlap collision; {{loserExtractor}} (at {{loserRange}}) lost to {{winnerExtractor}} (at {{winnerRange}}) by {{reason}}, only the winning edge persists',

  /**
   * Same warn but for the rare case the resolver rejected a Signal
   * because the operator disabled its extractor via
   * `plugins.<id>.extensions.<extId>.enabled`. Phase 4+ stub: today the
   * filter is not wired so this template is unreachable from the
   * resolver; documented now so the analyzer stays forward-compatible
   * with the upcoming filter pass. The remediation hint moves to
   * `Issue.fix.summary`.
   */
  messageExtractorDisabled: 'Dropped; extractor `{{extractorId}}` is disabled',
  /** Remediation hint for the `extractorDisabled` finding. */
  extractorDisabledFixSummary:
    'Re-enable it in Settings or via `sm plugins enable`.',

  /**
   * Same warn but for the future confidence floor case. Phase 4+ stub:
   * today the resolver materialises every winning candidate regardless
   * of confidence, so this template is unreachable; documented for
   * forward compatibility.
   */
  messageBelowFloor:
    'Dropped; confidence {{confidence}} is below the threshold {{threshold}}',
} as const;
