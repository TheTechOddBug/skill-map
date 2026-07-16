/**
 * CLI strings emitted by `sm findings` (`cli/commands/findings.ts`).
 *
 * `sm findings` reads `state_findings` from the DB: the judgments
 * recorded by probabilistic finder Analyzers plus the kernel-derived
 * safety rows. Advisory by construction, exit 0 regardless of content;
 * the deterministic sibling with exit-code semantics is `sm check`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const FINDINGS_CLI_TEXTS = {
  /**
   * The ONLY clean-verdict line: zero rows matched, stale ones included
   * (`spec/cli-contract.md` §sm findings). Green `✓`, because nothing is
   * being held back.
   */
  noFindings: '{{glyph}}  No findings.\n',
  /**
   * Empty result under an explicit bucket filter (`--fixed` / `--stale`)
   * that narrowed EXISTING rows out (`spec/cli-contract.md` §sm findings:
   * "an empty filtered result renders the same no-match shape the other
   * filters use, never the clean-verdict line"). Neutral `ℹ`: a green `✓`
   * would falsely assert a clean node while open rows may sit behind the
   * filter, and there is no excluded-count block here (that device is a
   * default-view honesty tool, off once the operator narrows to a bucket).
   */
  noMatch: '{{glyph}}  No findings match the current filter.\n',
  /**
   * Empty result while the default filter holds rows BACK (fixed and/or
   * stale). Not a clean verdict: judgments exist for the node, they just
   * sit hidden, so the line names the hidden breakdown and its remedy
   * under the neutral `ℹ` (a green `✓` here would assert a clean node and
   * read as "your data is gone", the exact lie this shape exists to kill).
   */
  noFreshFindings:
    '{{glyph}}  No fresh findings. {{breakdown}} hidden{{humanDecision}}.\n' +
    '   {{hint}}\n',
  /**
   * Footer under a NON-empty listing: the rows the default filter
   * excluded. Opens with its own blank-line separator so it detaches
   * from the last node section; the tip line follows.
   */
  staleHiddenFooter:
    '\n{{glyph}}  {{breakdown}} hidden{{humanDecision}}.\n' +
    '   {{hint}}\n',
  /**
   * The two disjoint hidden-tally fragments, joined by
   * `hiddenBreakdownJoiner` into `{{breakdown}}` (a zero count is omitted,
   * never `0 fixed`). No noun inflection: the shared trailing `hidden` in
   * the templates above carries it once.
   */
  hiddenFixedFragment: '{{count}} fixed',
  hiddenStaleFragment: '{{count}} stale',
  hiddenBreakdownJoiner: ', ',
  /**
   * The reveal flag(s) named in the remedy hint, picked by which buckets
   * are actually hidden (both / fixed-only / stale-only). Flag literals,
   * authored by the CLI.
   */
  hiddenFlagsBoth: '--fixed / --stale',
  hiddenFlagsFixedOnly: '--fixed',
  hiddenFlagsStaleOnly: '--stale',
  /**
   * Appended (yellow) to either hidden-breakdown shape when some hidden
   * row carries `resolution = 'human-decision'` (`spec/cli-contract.md`
   * §sm findings: the excluded-count line MUST name the human-decision
   * subset).
   *
   * Why this exists: a fixer's edits for the OTHER findings stale the
   * whole node, so a finding it left for the author (a proposal awaiting
   * a decision) hides behind the default stale filter, exactly the TODO
   * the operator most needs. The bare count would report it as ordinary
   * staleness. No plural form (the phrase does not inflect).
   */
  staleHiddenHumanDecisionFragment: ' ({{count}} awaiting your decision)',
  /**
   * Remedy hint shared by both hidden-breakdown shapes, wrapped dim at the
   * call site. `{{flags}}` names the applicable reveal flag(s); `{{pronoun}}`
   * is `it` / `them` resolved by the total hidden count.
   */
  staleHiddenHint:
    'Pass {{flags}} to see {{pronoun}}, or re-run the finders to re-check {{pronoun}}.',

  /** Header summary line: `sm findings: 2 warnings · 1 info`. */
  summaryHeader: 'sm findings: {{summary}}\n\n',
  /**
   * Summary fragments joined by ` · `, each colored at the call site.
   * `{{plural}}` is `''` / `'s'` resolved by count (info has no plural
   * form), mirroring `sm check`'s header grammar.
   */
  summaryErrorFragment: '{{count}} error{{plural}}',
  summaryWarningFragment: '{{count}} warning{{plural}}',
  summaryInfoFragment: '{{count}} info',
  /** Section heading: one per node with at least one finding. */
  fileSection: '  {{file}}\n',
  /**
   * Finding row inside a node section:
   * ` 3:  ⚠  plug/finder  contradiction  message  (85%)`.
   * `{{idCol}}` is the right-aligned finding id + `:` (undimmed, it is the
   * operator's handle for `sm findings resolve <id>`); padded by the renderer
   * so glyphs align across single- and multi-digit ids. Glyph is the
   * severity marker (✕ / ⚠ / ℹ) wrapped in color at the call site;
   * `extensionId` and `type` are padded by the renderer so messages align;
   * `confidence` renders dim; `{{staleTag}}` carries the optional yellow
   * ` (stale)` marker under `--stale`.
   */
  findingRow: '{{idCol}}  {{glyph}}  {{extensionId}}  {{type}}  {{message}}  {{confidence}}{{staleTag}}\n',
  /** Confidence column value, composed dim at the call site. */
  confidenceValue: '({{percent}}%)',
  /**
   * Confidence column value when the recording agent declared a model
   * (`sm record --model`): the self-reported model id rides alongside
   * the percentage. Middle dot separator, mirror of `sm check`'s
   * summary joiner.
   */
  confidenceWithModelValue: '({{percent}}% · {{model}})',
  /** Marker appended (yellow) to a stale row when `--stale` includes it. */
  staleTag: '  (stale)',
  /**
   * Optional detail line under a finding row (the finder's longer
   * evidence), rendered dim. `{{indent}}` aligns it under the message
   * column.
   */
  detailLine: '{{indent}}{{detail}}\n',
  /**
   * Optional resolution line under a finding row: the lifecycle STATE this
   * finding moved into (`spec/db-schema.md` §state_findings). Aligned with
   * the detail line; `{{glyph}}` and `{{text}}` are composed at the call
   * site from the shapes below.
   */
  resolutionLine: '{{indent}}{{glyph}}  {{text}}\n',
  /**
   * `resolution = 'fixed'`, `resolution_actor = 'fixer'`: a fully
   * autonomous fix (zero user interaction). This line only shows under
   * `--fixed`, so a green `✓` is honest HERE. Rendered DIM: it is still a
   * STATE, not a verdict, only the finder re-judging confirms the defect is
   * gone (never write "resolved" / "verified").
   */
  resolutionFixedByFixer: 'fixed by {{fixer}}{{noteSuffix}}',
  /**
   * `resolution = 'fixed'`, `resolution_actor = 'human'` WITH a fixer that
   * ran: the agent's tools did the typing but a user interaction (an
   * approval, a choice among the fixer's options, an operator edit) made
   * the call, so the decision is attributed to the operator.
   */
  resolutionFixedByHumanWithFixer: 'fixed by {{fixer}} (your decision){{noteSuffix}}',
  /**
   * `resolution = 'fixed'`, `resolution_actor = 'human'`, NO fixer
   * (`resolution_by` null): the operator marked it fixed directly via
   * `sm findings resolve`.
   */
  resolutionFixedByHuman: 'fixed by you{{noteSuffix}}',
  /** The `: <note>` tail on a resolution line; omitted when the note is empty. */
  resolutionNoteSuffix: ': {{note}}',
  /**
   * `resolution = 'human-decision'`: a fixer proposed but the choice is the
   * author's. This is the HIGHER-VALUE state, so it renders under a yellow
   * `⚠` with UNDIMMED text: the note is the fixer's PROPOSAL, the author's
   * TODO and the reason this feature exists (it used to sit buried in the
   * execution report).
   */
  resolutionHumanDecision: '{{fixer}} proposes, your decision{{noteSuffix}}',
  /** Footer hint, separated from the body by a blank line. */
  tipLine:
    '\nTip: `sm show <path>` shows a node\'s findings in context; findings are advisory and never gate exit codes.\n',

  // --- sm findings prune ---------------------------------------------------
  pruneNone: '{{glyph}}  No stale findings.\n',
  pruneConfirm:
    'sm findings prune is about to delete {{count}} stale finding{{plural}} ' +
    '(body changed since the judgment, or the node left the scan).\n' +
    'Fresh findings are never touched. Proceed?',
  pruneAborted: '{{glyph}}  sm findings prune: aborted by user. No rows deleted.\n',
  pruneSummary: '{{glyph}}  Deleted {{deleted}} stale finding{{plural}}.\n',
  pruneSummaryDryRun:
    '{{glyph}}  Would delete {{wouldDelete}} stale finding{{plural}}{{dryTag}}\n',
  pruneDryRunTag: '  (dry-run)',

  // --- flag validation (exit 2) ------------------------------------------
  errBadSeverity:
    '{{glyph}}  --severity: invalid value "{{value}}".\n' +
    '   {{hint}}\n',
  errBadSeverityHint: 'Allowed: info, warn, error (minimum severity, e.g. warn keeps warn + error).',
  errBadSince:
    '{{glyph}}  --since: cannot parse "{{value}}" as a date.\n' +
    '   {{hint}}\n',
  errBadSinceHint: 'Pass an ISO date, e.g. 2026-07-01 or 2026-07-01T12:00:00Z.',
  errBadThreshold:
    '{{glyph}}  --threshold: invalid value "{{value}}".\n' +
    '   {{hint}}\n',
  errBadThresholdHint: 'Pass a number between 0 and 1, e.g. 0.7.',

  // --- sm findings resolve <id> ------------------------------------------
  /**
   * Success line for `sm findings resolve <id>`: the operator marked the
   * finding fixed themselves. Honest state, NOT a verification (only
   * re-running the finder verifies the defect is gone).
   */
  resolveDone: '{{glyph}}  Finding {{id}} marked fixed by you.\n',
  /** Exit 5: no finding carries that id. */
  resolveNotFound:
    '{{glyph}}  Finding {{id}} not found.\n' +
    '   {{hint}}\n',
  resolveNotFoundHint:
    'Run `sm findings` to list finding ids (`sm scan` first if the DB is empty).',
  /** Exit 2: the finding is already fixed (re-marking is a no-op). */
  resolveAlreadyFixed:
    '{{glyph}}  Finding {{id}} is already fixed.\n' +
    '   {{hint}}\n',
  resolveAlreadyFixedHint:
    'A fixed finding stays re-checkable; re-run the finder to confirm the defect is gone.',
  /** Exit 2: the positional id is not a positive integer. */
  resolveBadId:
    '{{glyph}}  findings resolve: invalid id "{{value}}".\n' +
    '   {{hint}}\n',
  resolveBadIdHint: 'Pass the integer id shown by `sm findings`, e.g. 42.',
} as const;
