/**
 * CLI strings emitted by `sm plugins` (`cli/commands/plugins.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const PLUGINS_TEXTS = {
  // --- enable / disable error guidance --------------------------------
  // Spec § A.7, granularity validation. The CLI rejects mismatched ids
  // up front (instead of silently writing a config_plugins row that the
  // runtime would later ignore) so the user learns the model immediately.
  /**
   * Granularity-mismatch errors share a structured shape:
   *   ✕  <headline>
   *      <fix-line>
   *      <hint-line>
   * Glyph + indent + dim hint applied at the call site so all four
   * "wrong shape" advisories read the same way.
   */
  granularityBundleRejectsQualified:
    "{{glyph}}  '{{bundleId}}' has granularity=bundle.\n" +
    '   Use `sm plugins {{verb}} {{bundleId}}` to {{verb}} the whole bundle.\n' +
    '   {{hint}}\n',
  granularityBundleRejectsQualifiedHint:
    'Individual extensions inside a bundle-granularity plugin cannot be toggled.',

  granularityExtensionRejectsBundleId:
    "{{glyph}}  '{{bundleId}}' has granularity=extension.\n" +
    '   Use `sm plugins {{verb}} {{bundleId}}/<ext-id>` to {{verb}} a single extension.\n' +
    '   {{hint}}\n',
  granularityExtensionRejectsBundleIdHint:
    'Run `sm plugins list` for the per-extension qualified ids.',

  pluginNotFound:
    '{{glyph}}  Plugin not found: {{id}}\n' +
    '   {{hint}}\n',
  pluginNotFoundHint:
    'Run `sm plugins list` for discovered ids and the qualified extension ids.',

  pluginLocked:
    '{{glyph}}  Plugin "{{id}}" is locked by the host and cannot be toggled.\n' +
    '   {{hint}}\n',
  pluginLockedHint:
    'Locked plugins are mandatory for correct operation. To remove the lock, edit `src/kernel/config/locked-plugins.ts`.',

  qualifiedIdNotFound:
    '{{glyph}}  Qualified extension id not found: {{id}}\n' +
    "   The owning bundle '{{bundleId}}' does not declare an extension with id '{{extId}}'.\n" +
    '   {{hint}}\n',
  qualifiedIdNotFoundHint:
    'Run `sm plugins list` to see what each bundle ships.',

  qualifiedIdUnknownBundle:
    '{{glyph}}  Qualified extension id references unknown bundle: {{bundleId}}\n' +
    '   {{hint}}\n',
  qualifiedIdUnknownBundleHint:
    'Run `sm plugins list` for known bundle ids.',

  // Spec § A.10, `applicableKinds` filter on Extractors. When an extractor
  // declares a kind that no installed Provider emits, the load succeeds
  // (the Provider may arrive later) but `sm plugins doctor` surfaces a
  // non-blocking warning so the author sees the typo / missing dependency.
  // Exit code is NOT promoted by this warning.
  // The id is rendered as the entry header (`⚠  <id>`); the body skips
  // re-stating it so the message reads cleanly under the entry.
  doctorApplicableKindUnknown:
    "Declares applicableKinds including '{{unknownKind}}', but no installed Provider declares that kind. " +
    'The extractor is loaded but will never fire on that kind.',
  // Phase 7 / View contribution system, defence-in-depth slot drift
  // check. AJV at manifest load already rejects unknown slots as
  // `invalid-manifest`, but a plugin authored against an older catalog
  // whose `catalogCompat` satisfies the current major syntactically can
  // still ship a slot id that was renamed / removed. The doctor pass
  // surfaces those so the user runs `sm plugins upgrade` to migrate.
  // Exit code is NOT promoted by this warning.
  // The id is rendered as the entry header
  // (`⚠  <pluginId>/<extensionId>/<contributionId>`); the body skips
  // re-stating it so the message reads cleanly under the entry.
  doctorUnknownSlot:
    "Contribution '{{contributionId}}' targets unknown slot '{{slot}}'. " +
    'Run `sm plugins upgrade {{pluginId}}` or update the plugin to a slot in the current catalog (`sm plugins slots list`).',

  // --- list verb -------------------------------------------------------
  listEmpty: 'No plugins discovered.\n',

  // --- doctor verb -----------------------------------------------------
  /**
   * One-line summary that opens the human doctor output.
   * `enabled` is the count of toggleable units, bundle-granularity
   * bundles count once each, extension-granularity bundles count one
   * per individual extension. The `enabledBreakdown` interpolation
   * (e.g. `4 bundles + 27 extensions`) spells out the math so the user
   * does not chase a phantom delta against `sm plugins list` (which
   * always lists individual extensions).
   */
  doctorSummary:
    'plugins doctor: {{enabled}} enabled ({{enabledBreakdown}}) · {{issues}} issue{{issuesPlural}} · {{warnings}} warning{{warningsPlural}}\n\n',
  /** Source breakdown row (built-in vs user). Indented 4 to match the status rows. */
  doctorSourceRow: '    {{label}}  {{count}}\n',
  /** Status breakdown table heading. */
  doctorStatusHeader: '\n  Status\n',
  /** Status breakdown row (label padded by render). */
  doctorStatusRow: '    {{label}}  {{count}}\n',
  /** Source breakdown table heading. */
  doctorSourceHeader: '  Source\n',
  /** Warnings section heading (rendered when total > 0). */
  doctorWarningsHeader: '\n  Warnings ({{count}})\n',
  /** Single warning entry: indented yellow glyph + qualified id + wrapped body. */
  doctorWarningEntry: '    {{glyph}}  {{id}}\n',
  doctorWarningBody: '       {{line}}\n',
  /** Issues section heading (rendered when total > 0). */
  doctorIssuesHeader: '\n  Issues ({{count}})\n',
  doctorIssueEntry: '    {{glyph}}  {{id}}  {{status}}\n',
  doctorIssueBody: '       {{line}}\n',

  // --- enable / disable -----------------------------------------------
  /**
   * §3.1b two-line block. Mutex between explicit ids and `--all`; the
   * hint names the two valid invocation shapes so the operator can
   * re-run without re-reading `--help`.
   */
  toggleBothIdAndAll:
    '{{glyph}}  Pass either one or more <id> arguments or --all, not both.\n' +
    '   {{hint}}\n',
  toggleBothIdAndAllHint:
    'Examples: `sm plugins {{verb}} <id1> <id2>` (explicit set), `sm plugins {{verb}} --all` (every discovered plugin).',
  /**
   * §3.1b two-line block, dual of the mutex above: neither input was
   * given. Same hint shape so both rejection paths read in parallel.
   */
  toggleNeitherIdNorAll:
    '{{glyph}}  Pass one or more <id> arguments, or --all.\n' +
    '   {{hint}}\n',
  toggleNeitherIdNorAllHint:
    'Examples: `sm plugins {{verb}} <id1> <id2>` (explicit set), `sm plugins {{verb}} --all` (every discovered plugin).',
  toggleResolveError: '{{error}}',
  toggleAppliedSingle: '{{verbPast}}: {{id}}\n',
  toggleAppliedManyHeader: '{{verbPast}}: {{count}} plugin(s)\n',
  toggleAppliedManyRow: '  - {{id}}\n',

  // --- list / show renderers ------------------------------------------
  rowStatusOk: 'ok',
  rowStatusOff: 'off',
  rowStatusOkPad: 'ok  ',
  rowStatusOffPad: 'off ',
  /** ✓ / ✕ glyphs used by the human renderer (color applied at call site). */
  rowGlyphOk: '✓',
  rowGlyphOff: '✕',
  /** Right-side label distinguishing built-ins from user plugins. */
  sourceBuiltIn: 'built-in',
  sourceUser: 'user',
  /**
   * Compact bundle row: `  GLYPH  ID(pad)  N ext   SOURCE`.
   * Padding for `id` and `count` is computed at render time so all rows
   * align regardless of length. The glyph is wrapped in color before the
   * template substitution.
   */
  bundleRow: '  {{glyph}}  {{id}}{{count}} ext   {{source}}',
  /**
   * Indent applied to the names / reason lines under each bundle row.
   * Kept as a single source of truth so the wrap math (`wrapNames`) and
   * the visible output stay in sync.
   */
  bundleSubIndent: '       ',
  listTipShow:
    '\nTip: `sm plugins show <id>` for kinds, versions, and per-extension status.\n',
  /** Show command, built-in header (no version row, no path). */
  detailHeaderBuiltIn: '  {{glyph}}  {{id}}   {{source}}   {{count}} extension{{plural}}\n',
  /**
   * Show command, user-plugin header. Version always present (defaults
   * to `?` when the manifest omits it). Source labelled `user`; disabled
   * / failed states surface via the glyph (✕) only, the source label
   * stays the same so users learn that the plugin _is_ a user one
   * regardless of its load state.
   */
  detailHeaderUser: '  {{glyph}}  {{id}}   v{{version}}   {{source}}{{extCount}}\n',
  /** Field row used for Path / Compat / Summary / Reason. */
  detailFieldRow: '  {{label}}  {{value}}\n',
  /** Field labels (padded at render time to align with the longest in the block). */
  detailFieldPath: 'Path',
  detailFieldCompat: 'Compat',
  detailFieldSummary: 'Summary',
  detailFieldReason: 'Reason',
  /** Extensions block heading, separated from the header by a blank line. */
  detailExtensionsBlock: '\n',
  /**
   * Extension row WITH per-extension glyph (granularity=extension).
   * Used by built-in `core` and any user plugin that opts in. Padding
   * for {{kind}} and {{name}} is computed at render time so columns
   * align inside the block.
   */
  detailExtensionRowGlyph: '    {{glyph}}  {{kind}}  {{name}}  v{{version}}\n',
  /**
   * Extension row WITHOUT per-extension glyph (granularity=bundle).
   * The bundle is the only toggle; per-extension status is implicit.
   */
  detailExtensionRowBare: '       {{kind}}  {{name}}  v{{version}}\n',
  detailVersionUnknown: '?',
  detailCompatUnknown: '?',
  /**
   * Show command, single-extension header (qualified `<bundle>/<ext>` id
   * shape). Mirrors `detailHeaderBuiltIn` but the count slot is replaced
   * by the kind so the reader sees at a glance whether they are looking
   * at an extractor, analyzer, etc. Version moves down into the field
   * block so the layout matches the user-plugin detail's field-block
   * convention.
   */
  detailHeaderExtensionBuiltIn:
    '  {{glyph}}  {{qualifiedId}}   {{source}}\n',
  detailHeaderExtensionUser:
    '  {{glyph}}  {{qualifiedId}}   {{source}}\n',
  /** Field labels used by the single-extension detail view. */
  detailFieldKind: 'Kind',
  detailFieldVersion: 'Version',
  detailFieldStability: 'Stability',
  detailFieldDescription: 'Description',
  detailFieldPreconditions: 'Preconditions',
  detailFieldEntry: 'Entry',

  // --- create verb -----------------------------------------------------
  /**
   * §3.1b two-line block. Rejected when `<plugin-id>` fails the
   * kebab-case lowercase regex; hint spells out the acceptance rule and
   * a concrete example so the operator can re-run.
   */
  createInvalidId:
    '{{glyph}}  Plugin id must be kebab-case lowercase (got: {{id}}).\n' +
    '   {{hint}}\n',
  createInvalidIdHint:
    'Use a-z, 0-9, and hyphens between segments (e.g. `my-plugin`, `kw-counter`).',
  /**
   * §3.1b two-line block. Target directory exists and `--force` was not
   * passed; the hint surfaces the override flag.
   */
  createRefuseOverwrite:
    '{{glyph}}  Refusing to overwrite {{targetDir}}.\n' +
    '   {{hint}}\n',
  createRefuseOverwriteHint: 'Pass --force to overwrite the existing directory.',
  /**
   * Success block printed after scaffolding. Follows the no-em-dash rule
   * across every line.
   */
  createSuccess:
    'Created {{targetDir}}\n' +
    'Next:\n' +
    '  - Edit {{pluginId}}/extractors/{{pluginId}}-extractor/index.js (the extract() body)\n' +
    '  - Run sm scan to see the contribution surface\n' +
    '  - sm plugins slots list: browse other slots\n',

  // --- slots list verb -------------------------------------------------
  /** Section header for the view-slots catalogue. */
  slotsListHeaderViewSlots: '  View slots ({{count}})\n',
  /** Section header for the input-types catalogue (leading blank line). */
  slotsListHeaderInputTypes: '\n  Input types ({{count}})\n',
  /** Trailing tip; the `{{tip}}` is the dim-wrapped tip text. */
  slotsListTipFooter: '\n{{tip}}\n',
  /** Tip body, dim-wrapped by the caller. */
  slotsListTipText: 'Tip: full spec at spec/view-slots.md and spec/input-types.md.',
} as const;
