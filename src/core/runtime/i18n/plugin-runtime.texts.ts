/**
 * Strings emitted by the plugin runtime loader (`core/runtime/plugin-runtime.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Lives under `core/runtime/i18n/` so the texts travel with the module.
 * The historic `cli/i18n/plugin-runtime.texts.ts` was moved here when the
 * loader migrated out of `cli/util/` (the BFF consumes it too).
 */

export const PLUGIN_RUNTIME_TEXTS = {
  /**
   * Stderr-ready warning for one non-loaded plugin. Format keeps the
   * status word and the reason scannable so a user can grep
   * `incompatible-spec` / `invalid-manifest` / `load-error`.
   */
  warningRow: 'plugin {{id}}: {{status}} — {{reason}}',

  /** Placeholder when a non-loaded plugin record carries no `reason`. */
  warningReasonMissing: '(no reason recorded)',
} as const;
