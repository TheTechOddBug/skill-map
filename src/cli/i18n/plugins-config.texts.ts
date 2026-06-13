/**
 * CLI strings emitted by `sm plugins config`
 * (`cli/commands/plugins/config.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation. English
 * only per AGENTS.md; no em dashes.
 */

export const PLUGINS_CONFIG_TEXTS = {
  // --- id-shape redirects ----------------------------------------------
  // `sm plugins config` operates on one extension. A bare plugin id is
  // the wrong granularity, redirect to `sm plugins list <id>`.
  bareId:
    '{{glyph}}  `sm plugins config` needs a qualified `<plugin>/<ext>` id; "{{id}}" is a plugin.\n' +
    '   {{hint}}\n',
  bareIdHint:
    'Run `sm plugins list {{id}}` to see the extensions, then `sm plugins config {{id}}/<ext>`.',

  // --- no declared settings --------------------------------------------
  noSettings:
    '{{glyph}}  Extension "{{id}}" declares no configurable settings.\n' +
    '   {{hint}}\n',
  noSettingsHint:
    'Run `sm plugins show {{id}}` to inspect the extension.',

  unknownSetting:
    '{{glyph}}  Unknown setting "{{settingId}}" for extension "{{id}}".\n' +
    '   {{hint}}\n',
  unknownSettingHint:
    'Declared settings: {{declared}}.',

  // --- coercion / validation -------------------------------------------
  coerceFailed:
    '{{glyph}}  Could not parse "{{value}}" as type {{type}} for setting "{{settingId}}".\n' +
    '   {{hint}}\n',
  coerceFailedHint:
    '{{detail}}',
  validationFailed:
    '{{glyph}}  Invalid value for setting "{{settingId}}" ({{type}}): {{reason}}.\n',
  writeFailed:
    '{{glyph}}  Failed to write setting "{{settingId}}": {{message}}\n',

  // --- table view (no settingId) ---------------------------------------
  /** Section header above the settings table. */
  tableHeader: '  Settings for {{id}}\n',
  /** One table row: setting id, effective value, source layer tag. */
  tableRow: '  {{settingId}}  {{value}}{{sourceTag}}\n',
  /** Dim suffix showing which layer set the effective value. */
  tableSourceTag: ' [{{source}}]',
  /** Redaction placeholder for `secret`-typed values in any output. */
  redacted: '<redacted>',

  // --- write / reset receipts ------------------------------------------
  setWritten:
    '{{glyph}}  Set {{settingId}} = {{value}} for {{id}}{{wroteTag}}\n',
  setWroteTag: ' (wrote {{path}})',
  resetRemoved:
    '{{glyph}}  Cleared {{settingId}} for {{id}}; falls back to the declared default{{wroteTag}}\n',
  resetNoOverride:
    '{{glyph}}  No override set for {{settingId}} on {{id}}; nothing to clear.\n',

  // --- re-scan footer ---------------------------------------------------
  rescanFooter:
    '{{hint}}\n',
  rescanFooterText:
    'Settings are read once per scan; run `sm scan` to apply.',
} as const;
