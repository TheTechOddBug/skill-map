/**
 * CLI strings emitted by `sm check` (`cli/commands/check.ts`).
 *
 * `sm check` reads the persisted issue table from the DB and prints
 * every current row. Deterministic-only by construction: probabilistic
 * analyzers queue via `sm jobs submit` and report via `sm findings`,
 * never through this verb.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const CHECK_TEXTS = {
  noIssues: '{{glyph}}  No issues.\n',

  /** Header summary line: `sm check: 10 warnings · 0 errors`. */
  summaryHeader: 'sm check: {{summary}}\n\n',
  /**
   * Summary fragments joined by ` · `, each colored at the call site.
   * `{{plural}}` is `''` / `'s'` resolved by count, matching the
   * `{{plural}}`-slot pattern used across the other verbs (info has no
   * plural form).
   */
  summaryErrorFragment: '{{count}} error{{plural}}',
  summaryWarningFragment: '{{count}} warning{{plural}}',
  summaryInfoFragment: '{{count}} info',
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
    '\nTip: `sm enrich <node>` to revalidate a file after fixes.\n',

  /**
   * Emitted on stderr when `--analyzers` lists one or more ids the
   * loaded analyzer registry does not know. The user almost always
   * mistyped (e.g. `broken-ref` instead of `reference-broken`); listing
   * the valid ids inline lets them fix the call without a second round
   * trip through `sm plugins list`. Exit code is `ExitCode.Error` (2):
   * bad usage, not "no issues found".
   */
  unknownAnalyzerIds:
    'sm check: unknown analyzer id(s) in --analyzers: {{unknown}}.\n' +
    'Valid ids (qualified or short form accepted):\n{{known}}\n',
} as const;
