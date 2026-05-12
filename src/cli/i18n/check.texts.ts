/**
 * CLI strings emitted by `sm check` (`cli/commands/check.ts`).
 *
 * `sm check` reads the persisted issue table from the DB and prints
 * every current row. The `--include-prob` opt-in flag (spec § A.7)
 * detects probabilistic Analyzers registered via the plugin runtime and
 * emits a stderr advisory naming the analyzer ids that would dispatch as
 * jobs once the job subsystem ships at Step 10. The flag default is
 * unchanged: deterministic-only, CI-safe, no advisory.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const CHECK_TEXTS = {
  noIssues: '{{glyph}}  No issues.\n',

  /** Header summary line: `sm check: 10 warnings · 0 errors`. */
  summaryHeader: 'sm check: {{summary}}\n\n',
  /** Section heading: one per file with at least one issue. */
  fileSection: '  {{file}}\n',
  /**
   * Issue row inside a file section: `⚠  analyzer-id   message`.
   * Glyph is the severity marker (✕ / ⚠ / ℹ) wrapped in color at the
   * call site. `analyzerId` padded by the renderer so messages align.
   */
  issueRow: '    {{glyph}}  {{analyzerId}}   {{message}}\n',
  /** Footer hint, separated from the body by a blank line. */
  tipLine:
    '\nTip: `sm refresh <node>` to revalidate a file after fixes.\n',

  // --- prob stub advisory ---------------------------------------------------
  probStubAdvisory:
    'sm check --include-prob: probabilistic Analyzer dispatch requires the job ' +
    'subsystem (Step 10). Stub: skipped {{count}} probabilistic analyzer(s): ' +
    '{{analyzerIds}}. Deterministic analyzers ran as usual; full dispatch lands when ' +
    'the job subsystem ships.\n',

  probStubAdvisoryAsync:
    'sm check --include-prob --async: probabilistic Analyzer dispatch requires ' +
    'the job subsystem (Step 10). Stub: skipped {{count}} probabilistic ' +
    'analyzer(s): {{analyzerIds}}. The --async flag is reserved for future encoding ' +
    '(returns job ids without waiting once jobs land); today it is a no-op. ' +
    'Deterministic analyzers ran as usual.\n',
} as const;
