/**
 * CLI strings emitted by `sm plugins` (`cli/commands/plugins.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const PLUGINS_TEXTS = {
  // --- enable / disable error guidance --------------------------------
  pluginNotFound:
    '{{glyph}}  Plugin not found: {{id}}\n' +
    '   {{hint}}\n',
  pluginNotFoundHint:
    'Run `sm plugins list` for discovered ids and the qualified extension ids.',

  pluginLocked:
    '{{glyph}}  Plugin "{{id}}" is locked by the host and cannot be toggled.\n' +
    '   {{hint}}\n',
  pluginLockedHint:
    'Locked extensions are mandatory for correct operation; the lock is declared on the extension manifest (`locked: true`) and is not user-editable.',

  qualifiedIdNotFound:
    '{{glyph}}  Qualified extension id not found: {{id}}\n' +
    "   The owning plugin '{{pluginId}}' does not declare an extension with id '{{extId}}'.\n" +
    '   {{hint}}\n',
  qualifiedIdNotFoundHint:
    'Run `sm plugins list` to see what each plugin ships.',

  qualifiedIdUnknownPlugin:
    '{{glyph}}  Qualified extension id references unknown plugin: {{pluginId}}\n' +
    '   {{hint}}\n',
  qualifiedIdUnknownPluginHint:
    'Run `sm plugins list` for known plugin ids.',

  // --- verb-shape redirects (show is extension-only; list is plugin-only) ---
  // `sm plugins show` takes a qualified `<plugin>/<ext>` id and renders a
  // single extension. A bare plugin id is the wrong granularity, redirect
  // to `sm plugins list <id>`, which renders the whole plugin.
  showBareId:
    '{{glyph}}  `sm plugins show` needs a qualified `<plugin>/<ext>` id; "{{id}}" is a plugin.\n' +
    '   {{hint}}\n',
  showBareIdHint:
    'Run `sm plugins list {{id}}` for the plugin and its extensions, then `sm plugins show {{id}}/<ext>` for one.',
  // `sm plugins list <id>` takes a bare plugin id. A qualified
  // `<plugin>/<ext>` id targets a single extension, redirect to
  // `sm plugins show`.
  listQualifiedId:
    '{{glyph}}  `sm plugins list` takes a plugin id, not a qualified `<plugin>/<ext>` id: {{id}}\n' +
    '   {{hint}}\n',
  listQualifiedIdHint:
    'Run `sm plugins show {{id}}` for that extension, or `sm plugins list {{pluginId}}` for the whole plugin.',

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
   * One-line summary that opens the human doctor output. `enabled` is
   * the count of enabled extensions across every plugin (every
   * extension is independently toggle-able by its qualified id); the
   * value matches the row count rendered by `sm plugins list` once
   * disabled extensions are filtered out.
   */
  doctorSummary:
    'plugins doctor: {{enabled}} enabled extension{{enabledPlural}} · {{issues}} issue{{issuesPlural}} · {{warnings}} warning{{warningsPlural}}\n\n',
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

  // --- runtime contribution errors (last scan) -------------------------
  /**
   * "off-shape visible" follow-up. Section heading for view
   * contributions the last scan REJECTED at emit time (undeclared ref,
   * or payload failed the slot's AJV schema). Rendered only when at
   * least one error was persisted; promotes the exit code to 1.
   * `count` is the total error row count across every plugin.
   */
  doctorContribErrorsHeader: '\n  Runtime contribution errors (last scan) ({{count}})\n',
  /** Per-plugin group header: red glyph + plugin id + this plugin's error count. */
  doctorContribErrorEntry: '    {{glyph}}  {{pluginId}}  ({{count}})\n',
  /** Sample line under a plugin group: wrapped, dimmed diagnostic message. */
  doctorContribErrorBody: '       {{line}}\n',
  /** Trailing dimmed note when a plugin has more errors than the sample cap shows. */
  doctorContribErrorMore: '       {{line}}\n',
  /** Body of the "more" note: the count of samples omitted under this plugin. */
  doctorContribErrorMoreText: '... and {{count}} more',

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
  toggleAppliedManyHeader: '{{verbPast}}: {{count}} extension(s)\n',
  toggleAppliedManyRow: '  - {{id}}\n',
  /**
   * Pair-toggle informational header + rows: companions flipped by the
   * finder/fixer pairing rule (spec/plugin-author-guide.md §Paired
   * extensions (pair toggle)). Informational only, never a prompt; the
   * companions also appear in the applied receipt below.
   */
  pairToggleHeader: 'pair toggle: {{count}} paired extension(s) also {{verbPast}}:\n',
  pairToggleRow: '  - {{id}} (paired with {{via}})\n',

  // --- trust / untrust -------------------------------------------------
  /**
   * Receipt printed after `sm plugins trust|untrust`. `verbPast` is
   * `trusted` / `untrusted`. Trust is per-plugin (bare id), so the rows
   * carry plugin ids, not qualified extension ids.
   */
  trustAppliedSingle: '{{verbPast}}: {{id}}\n',
  trustAppliedManyHeader: '{{verbPast}}: {{count}} plugin(s)\n',
  trustAppliedManyRow: '  - {{id}}\n',
  /**
   * Rejection when a trust verb targets a built-in (or host-locked) id.
   * Those are never import-trust-gated, so a trust grant is meaningless.
   */
  trustBuiltInRejected:
    '{{glyph}}  Plugin "{{id}}" is a built-in (or host-locked) and is never import-trust-gated.\n' +
    '   {{hint}}\n',
  trustBuiltInRejectedHint:
    'Import trust applies only to project-local drop-in plugins under .skill-map/plugins/.',
  /** `--all` found no project-local drop-in plugins to act on. */
  trustNoPlugins: 'No project-local plugins discovered to {{verb}}.\n',

  /**
   * Macro expansion summary printed on stderr before the confirm
   * prompt (or before the `--yes` rejection). The block lists every
   * qualified extension id the bare plugin id resolves to, so the
   * user sees the exact set that would flip.
   */
  bundleMacroHeader: 'sm plugins {{verb}} {{pluginId}}: this will affect {{count}} extensions:\n',
  bundleMacroRow: '  - {{id}}\n',
  /**
   * Interactive prompt rendered to a TTY by the macro path. The
   * `confirm` helper appends the `[y/N]` suffix from UTIL_TEXTS.
   */
  bundleMacroConfirmPrompt: 'Apply this {{verb}} to every listed extension?',
  /**
   * Stderr advisory when a TTY user answers no to the macro prompt.
   * The verb exits non-zero (ExitCode.Error) so callers can detect
   * the cancellation.
   */
  bundleMacroCancelled: 'Cancelled.\n',
  /**
   * Non-TTY rejection path: pipes / CI cannot prompt, so the verb
   * refuses unless `--yes` is set. The body lines come from
   * `bundleMacroHeader` / `bundleMacroRow` above; this template adds
   * the directed re-run hint.
   */
  bundleMacroRequiresYes:
    '{{glyph}}  Refusing to {{verb}} multiple extensions without confirmation.\n' +
    '   {{hint}}\n',
  bundleMacroRequiresYesHint:
    'Re-run with --yes to apply, or pass a qualified id `<plugin>/<extension>` for a single extension.',

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
   * Compact plugin row: `  GLYPH  ID(pad)  N ext   SOURCE`.
   * Padding for `id` and `count` is computed at render time so all rows
   * align regardless of length. The glyph is wrapped in color before the
   * template substitution.
   */
  pluginRow: '  {{glyph}}  {{id}}{{count}} ext   {{source}}',
  /**
   * Indent applied to the names / reason lines under each plugin row.
   * Kept as a single source of truth so the wrap math (`wrapNames`) and
   * the visible output stay in sync.
   */
  pluginSubIndent: '       ',
  /**
   * Lifecycle tag appended to an extension name in list / show rows
   * when the manifest declares a non-default `stability` (anything but
   * `stable`). Inherits the surrounding line's color; `stable`
   * (declared or defaulted) renders no tag.
   */
  stabilityTag: ' ({{stability}})',
  listTipShow:
    '\nTip: `sm plugins list <id>` for a plugin\'s extensions (kinds, versions, per-extension status), `sm plugins show <plugin>/<ext>` for one extension.\n',
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
  /** `extCount` segment of `detailHeaderUser` when the plugin has extensions. */
  detailHeaderExtCount: '   {{extCount}} extension{{plural}}',
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
   * Extension row inside the plugin detail. Every extension is
   * independently toggle-able, so every row carries its own glyph
   * (✓ / ✕). Padding for {{kind}} and {{name}} is computed at render
   * time so columns align inside the block. `{{versionSuffix}}` is
   * either `  v<x.y.z>` (user plugins) or empty (built-in plugins,
   * which inherit the CLI version and do not maintain per-extension
   * versions of their own).
   */
  detailExtensionRowGlyph: '    {{glyph}}  {{kind}}  {{name}}{{versionSuffix}}\n',
  detailVersionUnknown: '?',
  detailCompatUnknown: '?',
  /**
   * Show command, single-extension header (qualified `<plugin>/<ext>` id
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
  /**
   * Probabilistic-extension contract sections (`sm plugins show`,
   * spec/cli-contract.md): the verbatim prompt template and the
   * pretty-printed report schema, rendered after the field block.
   * Content lines are plugin-authored; sanitized at render.
   */
  detailSectionPrompt: '\n  Prompt\n',
  detailSectionReportSchema: '\n  Report schema\n',
  detailSectionLine: '    {{line}}\n',

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
   * §3.1b two-line block. Rejected when the `<kind>` positional is not one
   * of the closed extension-kind catalog; the hint lists the valid kinds.
   */
  createInvalidKind:
    '{{glyph}}  Unknown extension kind (got: {{kind}}).\n' +
    '   {{hint}}\n',
  createInvalidKindHint: 'Use one of: {{kinds}}.',
  /**
   * §3.1b two-line block. Target directory exists and `--force` was not
   * passed; the hint surfaces the override flag.
   */
  createRefuseOverwrite:
    '{{glyph}}  Refusing to overwrite {{targetDir}}.\n' +
    '   {{hint}}\n',
  createRefuseOverwriteHint: 'Pass --force to overwrite the existing directory.',
  /**
   * Success block printed after scaffolding. Kind-agnostic (the main stub
   * path is interpolated). Follows the no-em-dash rule across every line.
   */
  createSuccess:
    'Created {{targetDir}}\n' +
    'Next:\n' +
    '  - Edit {{mainFile}}\n' +
    '  - Run sm plugins doctor to confirm it loads\n' +
    '  - Run sm plugins trust {{pluginId}} to let its code run (project-local plugins are untrusted until you allow them)\n' +
    '  - sm plugins slots list: browse slots and input-types\n',

  // --- slots list verb -------------------------------------------------
  /** Section header for the view-slots catalogue. */
  slotsListHeaderViewSlots: '  View slots ({{count}})\n',
  /** Section header for the input-types catalogue (leading blank line). */
  slotsListHeaderInputTypes: '\n  Input types ({{count}})\n',
  /** Trailing tip; the `{{tip}}` is the dim-wrapped tip text. */
  slotsListTipFooter: '\n{{tip}}\n',
  /** Tip body, dim-wrapped by the caller. */
  slotsListTipText: 'Tip: full spec at spec/view-slots.md and spec/input-types.md.',

  /**
   * `--all` confirm. Lists the ids about to be trusted so an unfamiliar
   * name is seen BEFORE consent, marking any whose grant came from
   * another copy of the project.
   */
  trustAllConfirm:
    'About to grant import trust to {{count}} project-local plugin(s), whose code will then run:\n' +
    '{{rows}}\n' +
    'Proceed?',
  trustAllRow: '  - {{id}}{{note}}',
  trustAllForeignNote: '   (granted in a different copy of this project)',
  trustAllAborted: '{{glyph}}  sm plugins trust: aborted by user. Nothing trusted.\n',

  /**
   * §3.1b block: the scope has no usable filesystem anchor, so no grant
   * can be minted or verified. Distinct from every other trust failure
   * because retrying is futile, the hint names the environment.
   */
  trustAnchorUnusable:
    '{{glyph}}  Cannot record trust in this project: the filesystem reports no creation time for .skill-map/.\n' +
    '   {{hint}}\n',
  trustAnchorUnusableHint:
    'Known on Windows drives mounted into WSL (/mnt/...), /proc and /sys. Move the project onto the native filesystem to trust plugins here.',

  // --- upgrade verb ----------------------------------------------------
  /** §3.1b block: explicit `<plugin-id>` matched no discovered plugin dir. */
  upgradeNotFound:
    "{{glyph}}  No plugin '{{id}}' under the project plugins dir; nothing to upgrade.\n" +
    '   {{hint}}\n',
  upgradeNotFoundHint: 'Run `sm plugins list` for discovered plugin ids.',
  /** Backfill row: plugin had no package.json; the canonical one was written. */
  upgradeBackfillCreated:
    '  {{glyph}}  {{id}}: wrote package.json ("type": "module") so Node loads its ESM extensions cleanly.\n',
  /** Backfill row: existing package.json gained `"type": "module"`. */
  upgradeBackfillAddedType: '  {{glyph}}  {{id}}: added "type": "module" to its package.json.\n',
  /** Warn row: package.json declares a foreign / malformed `type`; left untouched. */
  upgradeBackfillForeignType:
    '  {{glyph}}  {{id}}: package.json declares a non-module "type" (or is malformed); left untouched, check it if Node warns about the module type.\n',
  // --- extension.json migration -----------------------------------------
  /** Wrote a complete `extension.json` seeded from the module source. */
  upgradeExtCreated:
    '  {{glyph}}  {{where}}: wrote extension.json (version + description read from your module).\n',
  /** Wrote it, but a field could not be read out of the source. */
  upgradeExtPartial:
    '  {{glyph}}  {{where}}: wrote extension.json with TODO placeholders; fill them in (could not read the values out of the module source).\n',
  /**
   * The file exists but the module still declares the relocated fields,
   * so the plugin does not load. Upgrade never edits JavaScript, so this
   * is the one step that stays manual, and the message has to be precise
   * enough to act on without opening the spec.
   */
  upgradeExtStaleModule:
    '  {{glyph}}  {{where}}: delete {{fields}} from its {{indexFile}}; those fields live in extension.json now, and the plugin will not load until the module stops declaring them.\n',
  /** Section header, printed only when the migration touched something. */
  upgradeExtHeader: '\n  Extension manifests\n',
  /** Closing status (§3.1 single-line success + dim tip). */
  upgradeNoMigrations:
    '{{glyph}}  No catalog migrations registered for v1.0.0; all loaded plugins are catalog-current.\n' +
    '   {{tip}}\n',
  upgradeNoMigrationsTip: 'Run `sm plugins doctor` to surface any incompatible-catalog status.',
} as const;
