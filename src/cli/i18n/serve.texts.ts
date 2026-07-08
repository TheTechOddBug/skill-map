/**
 * CLI strings emitted by `sm serve` (`cli/commands/serve.ts`).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Error-shaped strings follow `context/cli-output-style.md` §3.1b
 * (glyph + headline + dim hint) wherever the failure has an actionable
 * next step. Generic failure wrappers (`startupFailed`, `bindFailed`)
 * stay single-line §3.1 because the inner `{{message}}` varies per
 * call site (validator branches, runtime throws). The caller resolves
 * the glyph at the seam via `ansiFor(...)` and threads it in.
 */

export const SERVE_TEXTS = {
  // The boot banner (TTY box / flat-line fallback) is rendered by
  // `cli/util/serve-banner.ts` rather than templated through `tx`,
  // ANSI escapes + box-drawing aren't a good fit for the flat
  // `{{name}}` interpolation surface. The flat-mode strings live in
  // that helper and stay byte-equivalent to the pre-banner format so
  // existing pipes / redirects ('listening on <url>' scrapers) don't
  // break.

  /**
   * Browser-open failure. Non-fatal advisory, the URL is already printed;
   * the user can open it manually. Yellow `⚠` per §3.1.
   */
  openFailed:
    '{{glyph}}  sm serve: could not auto-open browser ({{message}}). Visit {{url}} manually.\n',

  /**
   * Generic wrapper for bind-time runtime failures (port in use, EACCES,
   * etc.). Inner `{{message}}` varies, so this stays single-line §3.1
   * with a leading red `✕`.
   */
  bindFailed: '{{glyph}}  sm serve: failed to bind {{host}}:{{port}}: {{message}}\n',

  // --- flag-validation failures (ExitCode.Error) --------------------------

  /**
   * §3.1b error block when `--dev-cors` pairs with a non-loopback `--host`.
   * Decision #119 refuses the combo because the loopback-only assumption
   * carries the no-auth posture; the hint names the fix.
   */
  hostDevCorsRejected:
    '{{glyph}}  sm serve: --dev-cors requires a loopback --host (got {{host}}).\n' +
    '   {{hint}}\n',
  hostDevCorsRejectedHint:
    'Use --host 127.0.0.1 (or ::1) when --dev-cors is set. Multi-host serve reopens after v0.6.0 (Decision #119).',

  /**
   * §3.1b error block when `--host` is any non-loopback address (without
   * `--dev-cors`). The BFF is loopback-only and unauthenticated pre-1.0
   * (Decision #119), so binding off-loopback is refused outright rather
   * than relying on the DNS-rebinding gate as the sole control.
   */
  hostNotLoopback:
    '{{glyph}}  sm serve: --host must be a loopback address (got {{host}}).\n' +
    '   {{hint}}\n',
  hostNotLoopbackHint:
    'Use --host 127.0.0.1 (or ::1). The server has no auth and is loopback-only; multi-host serve reopens after v0.6.0 (Decision #119).',

  /**
   * §3.1b error block when `--port` falls outside the [0, 65535] range.
   * Hint names the accepted range so the operator can re-run.
   */
  portOutOfRange:
    '{{glyph}}  sm serve: --port must be an integer in [0, 65535] (got {{value}}).\n' +
    '   {{hint}}\n',
  portOutOfRangeHint: 'Pass a port between 0 and 65535 (0 lets the OS pick).',

  /**
   * §3.1b error block when `--port` is not a non-negative integer
   * (empty string, negative, trailing garbage). Hint matches
   * `portOutOfRange` so both rejection paths read the same way.
   */
  portInvalid:
    '{{glyph}}  sm serve: --port must be a non-negative integer (got {{value}}).\n' +
    '   {{hint}}\n',
  portInvalidHint: 'Pass an integer between 0 and 65535 (0 lets the OS pick).',

  // --- watcher option failures (ExitCode.Error) ---------------------------

  /**
   * §3.1b error block when `--no-built-ins` is paired with the watcher.
   * The watcher always persists each batch; an empty pipeline would
   * silently wipe the DB. Hint names the two valid escape hatches.
   */
  watcherRequiresPipeline:
    '{{glyph}}  sm serve: --no-built-ins is incompatible with the watcher.\n' +
    '   {{hint}}\n',
  watcherRequiresPipelineHint:
    'Pass --no-watcher to opt out of the watcher, or drop --no-built-ins so the watcher has something to persist.',

  /**
   * §3.1b error block when `--watcher-debounce-ms` is not a non-negative
   * integer. Hint mirrors the other numeric-flag rejections.
   */
  watcherDebounceInvalid:
    '{{glyph}}  sm serve: --watcher-debounce-ms must be a non-negative integer (got {{value}}).\n' +
    '   {{hint}}\n',
  watcherDebounceInvalidHint: 'Pass an integer >= 0 (e.g. 250).',

  /**
   * §3.1b error block for an invalid `--max-scan <N>`. Same shape as
   * the watcher-debounce template family.
   */
  maxScanInvalid:
    '{{glyph}}  sm serve: --max-scan must be an integer >= 1 (got {{value}}).\n' +
    '   {{hint}}\n',
  maxScanInvalidHint: 'Pass a positive integer, e.g. --max-scan 5000.',

  /**
   * §3.1b error block for an invalid `--max-nodes <N>`. Same shape as
   * the watcher-debounce template family.
   */
  maxNodesInvalid:
    '{{glyph}}  sm serve: --max-nodes must be an integer >= 1 (got {{value}}).\n' +
    '   {{hint}}\n',
  maxNodesInvalidHint: 'Pass a positive integer, e.g. --max-nodes 256.',

  /**
   * §3.1b error block for an invalid `--watch-backend <chokidar|parcel>`.
   * Same shape as the watcher-debounce template family.
   */
  watchBackendInvalid:
    '{{glyph}}  sm serve: --watch-backend must be "chokidar" or "parcel" (got {{value}}).\n' +
    '   {{hint}}\n',
  watchBackendInvalidHint: 'Pass one of: chokidar, parcel.',

  // --- --no-ui flag-validation failures (ExitCode.Error) ------------------

  /**
   * §3.1b error block when `--no-ui` is paired with an explicit
   * `--ui-dist`. The two are mutually exclusive (one says "skip the
   * SPA", the other points at a bundle).
   */
  noUiConflictsUiDist:
    '{{glyph}}  sm serve: --no-ui and --ui-dist {{path}} are mutually exclusive.\n' +
    '   {{hint}}\n',
  noUiConflictsUiDistHint: 'Drop one. Use --no-ui to serve without the SPA, or --ui-dist <path> to point at a custom bundle.',

  /**
   * Non-fatal advisory when `--no-ui` pairs with `--open` (the auto-open
   * targets the placeholder, not a live SPA). Yellow `⚠` per §3.1. The
   * literal `warning:` token stays in the body because external smoke
   * tests grep for it.
   */
  noUiOpenWarning:
    '{{glyph}}  sm serve: warning: --open with --no-ui will open the placeholder, not the live UI; pass --no-open if running alongside `ui:dev`.\n',

  /**
   * Generic wrapper for runtime failures that happen before the listener
   * binds (UI bundle missing under an explicit `--ui-dist`, validator
   * fall-through, etc.). Inner `{{message}}` varies, so this stays
   * single-line §3.1 with a leading red `✕`.
   */
  startupFailed: '{{glyph}}  sm serve: startup failed: {{message}}\n',

  /**
   * §3.1b error block when `--db <path>` points at a missing file.
   * Hint nudges the user toward `sm scan` (which creates the project
   * DB) or correcting the path.
   */
  dbNotFound:
    '{{glyph}}  sm serve: --db {{path}} does not exist.\n' +
    '   {{hint}}\n',
  dbNotFoundHint:
    'Run `sm scan` to create the project DB, or pass --db <path> pointing at an existing file.',

  /**
   * Inner body for `startupFailed` when `--ui-dist` points at a path
   * that is not a UI bundle directory (no `index.html`). Stays
   * placeholder-free so the wrapper adds the glyph.
   */
  uiDistInvalid:
    '--ui-dist {{path}} does not exist or is not a directory containing index.html',

  // Shutdown trace, printed once the listener has closed. Informational
  // (`ℹ` cyan) per §3.1: no failure, no action; just a marker that the
  // long-running daemon has wound down cleanly.
  shutdown: '{{glyph}}  sm serve: shutdown complete.\n',

  // Discovery-file write failure (best-effort, warn-and-continue): the
  // server keeps serving, but the activity bridge cannot find it this
  // session (see spec/provider-activity.md §serve.json).
  serveInfoWriteFailed:
    '{{glyph}}  sm serve: could not write {{path}}; live activity discovery is off for this session.\n',

  /**
   * §3.1b error block when the operator declines the pre-boot
   * schema-drift rebuild (TTY, no `--yes`). The server never starts;
   * the cache is left untouched. `{{reason}}` names the drift axis
   * (version skew vs an inline schema change).
   */
  driftDeclined:
    '{{glyph}}  sm serve: cache rebuild declined; the {{dbVersion}} cache cannot be reused on {{currentVersion}} ({{reason}}).\n' +
    '   {{hint}}\n',
} as const;
