/**
 * Strings emitted by `cli/commands/config.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const CONFIG_TEXTS = {
  unknownKey: 'Unknown config key: {{key}}\n',
  unknownKeySuggestion: 'Did you mean {{suggestions}}?\n',
  valueWithLayer: '{{value}}  {{layerTag}}\n',
  /** Dim source-layer suffix for `sm config show --source`. */
  valueLayerTag: '(from {{layer}})',
  invalidAfterSet: 'Invalid config after set: {{errors}}\n',
  setWritten: '{{glyph}}  {{key}} = {{value}}  {{wroteTag}}\n',
  /** Dim destination-path suffix for `sm config set`. */
  setWroteTag: '(wrote {{path}})',
  unsetNoOverride: '{{glyph}}  No override at {{path}} for {{key}}\n',
  unsetRemoved: '{{glyph}}  Removed {{key}} from {{path}}\n',
  loadFailure: 'sm config: {{message}}\n',
  forbiddenKeySegment: 'sm config: forbidden key segment "{{segment}}" in "{{key}}" (rejects __proto__ / constructor / prototype)\n',

  // --- list verb (sectioned human renderer) ----------------------------
  /** Section heading: `  General`, `  Scan`, … rendered before its rows. */
  listSectionHeader: '  {{title}}\n',
  /**
   * Single row inside a section. Key column is padded to the longest
   * displayed key in that section so values line up. Both columns
   * indented under the section heading.
   */
  listRow: '    {{key}}  {{value}}\n',
  /** Placeholder for null / empty array / empty object — printed dim. */
  listEmptyValue: '—',
  /** Section titles. */
  listSectionGeneral: 'General',
  listSectionScan: 'Scan',
  listSectionJobs: 'Jobs',
  listSectionRootsAndPlugins: 'Roots & plugins',
  listSectionHistory: 'History',
  listSectionOther: 'Other',
} as const;
