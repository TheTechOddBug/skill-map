/**
 * Strings emitted by `cli/commands/config.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const CONFIG_TEXTS = {
  unknownKey: '{{glyph}}  Unknown config key: {{key}}\n',
  unknownKeySuggestion: '   {{hint}}\n',
  unknownKeySuggestionHint: 'Did you mean {{suggestions}}?',
  valueWithLayer: '{{value}}  {{layerTag}}\n',
  /** Dim source-layer suffix for `sm config show --source`. */
  valueLayerTag: '(from {{layer}})',
  invalidAfterSet: '{{glyph}}  Invalid config after set: {{errors}}\n',
  setWritten: '{{glyph}}  {{key}} = {{value}}  {{wroteTag}}\n',
  /** Dim destination-path suffix for `sm config set`. */
  setWroteTag: '(wrote {{path}})',
  unsetNoOverride: '{{glyph}}  No override at {{path}} for {{key}}\n',
  unsetRemoved: '{{glyph}}  Removed {{key}} from {{path}}\n',
  loadFailure: '{{glyph}}  sm config: {{message}}\n',
  forbiddenKeySegment:
    '{{glyph}}  sm config: forbidden key segment "{{segment}}" in "{{key}}".\n' +
    '   {{hint}}\n',
  forbiddenKeySegmentHint: 'Rejects __proto__ / constructor / prototype.',

  /**
   * Surfaced when a PROJECT_LOCAL_ONLY key (`allowEditSmFiles` /
   * `scan.extraFolders` / `scan.referencePaths`) reaches the writer
   * with `target: 'project'`, defensive only, the CLI auto-routes to
   * `project-local`, but the helper enforces the rule for any other
   * caller too.
   */
  projectLocalOnlyKeyRejection:
    '{{glyph}}  sm config: "{{key}}" is project-local only and cannot live in committed settings.json.\n' +
    '   {{hint}}\n',
  projectLocalOnlyKeyRejectionHint:
    'Writes to .skill-map/settings.local.json (gitignored).',

  /**
   * Surfaced when `sm config set` is invoked on a privacy-sensitive
   * key (`scan.extraFolders` / `scan.referencePaths`) and the new
   * value would expand the scan's disk-access surface beyond the
   * project root. Without `--yes` the verb refuses the write and
   * lists the paths the change would expose so the operator decides
   * knowingly.
   */
  privacyGateRequired:
    '{{glyph}}  sm config: setting "{{key}}" to that value opens disk access outside this project.\n' +
    '   The following paths would be added to the scan surface:\n' +
    '{{paths}}\n' +
    '   {{hint}}\n',
  privacyGateRequiredHint:
    'Rerun with --yes to confirm. Writes that NARROW the surface (removing paths) need no flag.',
  /**
   * Receipt printed when the privacy gate has been confirmed via
   * `--yes`. Same path list as the rejection so the operator sees on
   * screen what they just opted into.
   */
  privacyGateConfirmed:
    '{{glyph}}  Opening disk access for "{{key}}":\n' +
    '{{paths}}\n',

  /**
   * Surfaced when `sm config set pluginTrust.projectEnabled true` is run
   * without `--yes`. Turning the opt-in on expands the LOCAL
   * code-execution surface (every plugin the project enables becomes
   * trusted), so the verb refuses without confirmation.
   */
  trustGateRequired:
    '{{glyph}}  sm config: setting "pluginTrust.projectEnabled" to true trusts every plugin this project enables.\n' +
    '   Their code may then import and run on this machine without a per-plugin trust grant.\n' +
    '   {{hint}}\n',
  trustGateRequiredHint:
    'Rerun with --yes to confirm. Turning it off needs no flag. Prefer per-plugin `sm plugins trust <id>` for narrower consent.',
  /**
   * Receipt printed when the trust gate has been confirmed via `--yes`.
   */
  trustGateConfirmed:
    '{{glyph}}  Local plugin trust opt-in enabled: every plugin this project enables is now trusted on this machine.\n',

  /**
   * Confirmation printed after `sm config set activeProvider <id>`
   * succeeds. The lens change atomically drops the scan_* zone (per
   * `architecture.md` §Active Provider Lens) so the persisted graph
   * never carries stale node / link rows from the previous lens. We
   * surface what was cleared so the operator knows their state was
   * touched and what to do next.
   */
  lensSwitchedCleared:
    '{{glyph}}  Lens switched. Cleared {{tableCount}} scan table(s): {{tableNames}}.\n' +
    '   {{hint}}\n',
  lensSwitchedClearedHint:
    'Run `sm scan` to repopulate the graph under the new lens.',
  /** Same lens-switch announcement when the DB was empty (no rows to clear). */
  lensSwitchedEmpty:
    '{{glyph}}  Lens switched. Scan zone was already empty.\n' +
    '   {{hint}}\n',
  /** Lens switch happened before any `sm scan` ran (no DB file on disk yet). */
  lensSwitchedNoDb:
    '{{glyph}}  Lens switched. Run `sm scan` to populate the graph under the new lens.\n',

  /**
   * Two-line §3.1b error block emitted when `sm config set
   * activeProvider <id>` is invoked with an id that no registered
   * Provider plugin contributes. The set is destructive (drops the
   * `scan_*` zone), so a typo (`clude` instead of `claude`) used to
   * silently switch to a non-existent lens and leave the graph empty.
   * This block names the rejected value and lists every allowed id so
   * the operator can re-run with a valid one.
   */
  activeProviderUnknown:
    '{{glyph}}  sm config: "activeProvider" rejects "{{value}}", no Provider plugin contributes that id.\n' +
    '   {{hint}}\n',
  activeProviderUnknownHint: 'Allowed: {{allowed}}.',

  // --- list verb (sectioned human renderer) ----------------------------
  /** Section heading: `  General`, `  Scan`, … rendered before its rows. */
  listSectionHeader: '  {{title}}\n',
  /**
   * Single row inside a section. Key column is padded to the longest
   * displayed key in that section so values line up. Both columns
   * indented under the section heading.
   */
  listRow: '    {{key}}  {{value}}\n',
  /** Placeholder for null / empty array / empty object, printed dim. */
  listEmptyValue: '-',
  /** Section titles. */
  listSectionGeneral: 'General',
  listSectionScan: 'Scan',
  listSectionJobs: 'Jobs',
  listSectionRootsAndPlugins: 'Roots & plugins',
  listSectionOther: 'Other',
} as const;
