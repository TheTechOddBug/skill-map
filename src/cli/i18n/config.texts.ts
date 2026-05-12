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
   * Surfaced when `sm config set` / `sm config reset` is invoked on a
   * user-only key (e.g. `updateCheck.enabled`) without `-g`. The hint
   * tells the user how to retry against the user-scope file.
   */
  userOnlyKeyRejection:
    '{{glyph}}  sm config: "{{key}}" is a user-scope key.\n' +
    '   {{hint}}\n',
  userOnlyKeyRejectionHint:
    'Rerun with -g to write to ~/.skill-map/settings.json.',

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
    'Writes to .skill-map/settings.local.json (gitignored), or -g for user scope.',

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
  listSectionHistory: 'History',
  listSectionOther: 'Other',
} as const;
