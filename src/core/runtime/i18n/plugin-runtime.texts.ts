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
   * Stderr-ready warning for one non-loaded plugin. The status in parens
   * stays greppable (`invalid-manifest` / `incompatible-spec` /
   * `load-error`); `all extensions skipped` states the consequence (the
   * loader rejects the plugin whole, aborting on the first bad
   * extension). The reason carries the specifics, so it must NOT restate
   * the status (no second "manifest invalid").
   */
  warningRow: 'plugin {{id}} ({{status}}), all extensions skipped: {{reason}}',

  /** Placeholder when a non-loaded plugin record carries no `reason`. */
  warningReasonMissing: '(no reason recorded)',

  /**
   * Executed-plugin notice. Loading a project-local plugin runs
   * third-party code in the operator's process, so it must never be
   * silent: one stderr line per run naming what executed. Emitted even
   * when every plugin is trusted, the point is that "third-party code
   * ran" is always observable, not only when something went wrong.
   *
   * The glyph is baked in rather than a `{{glyph}}` slot: this module is
   * colourless (it renders through a stream-based `IPrinter` with no
   * `IAnsi` in reach), and per `context/cli-output-style.md` §1 glyph
   * bytes print raw while colour is gated separately.
   */
  executedRow: 'ℹ  Loaded {{count}} project-local plugin{{plural}}: {{ids}}',
} as const;
