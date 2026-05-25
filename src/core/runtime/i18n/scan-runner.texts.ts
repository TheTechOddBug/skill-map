/**
 * Strings emitted from `core/runtime/scan-runner.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Only the strings the runtime itself emits live here; the framing
 * messages around the runner outcome (success summaries, "Persisted to
 * <path>", `--json` self-validation failure, scan-failure prefix) live
 * in `cli/i18n/scan.texts.ts` because they belong to the CLI verb's
 * presentation layer.
 *
 * The watcher runtime keeps its own catalogue (`core/watcher/runtime.ts`
 * inline `RUNTIME_TEXTS`), the strings are the same shape but the
 * surrounding context differs (a watcher tick vs a one-shot scan), so
 * sharing the catalogue would couple two runtimes that should remain
 * independent.
 */

export const SCAN_RUNNER_TEXTS = {
  /**
   * Emitted on stderr when the user passes `--changed` but no prior
   * snapshot exists in the DB. The runner falls back to a full scan.
   */
  changedNoPriorWarning: '--changed: no prior snapshot found; running full scan.\n',

  /**
   * Thrown as an `Error.message` when `--strict` is set and the
   * DB-resident prior `ScanResult` fails `scan-result.schema.json`
   * validation.
   */
  priorSchemaValidationFailed:
    'prior scan-result loaded from DB failed schema validation: {{errors}}. ' +
    'Run `sm db backup` then re-scan without --strict to rebuild from disk.',

  /**
   * Reference-paths walker hit `REFERENCE_WALK_MAX_FILES` and stopped
   * early. The set may be incomplete for link validation; `core/reference-broken`
   * still works against whatever made it in.
   */
  referenceWalkTruncated:
    'scan.referencePaths: walker truncated at the 50000-file safety cap. ' +
    'Some link targets may flag as broken even though they exist on disk. ' +
    'Trim the configured paths to dirs you actually need to validate against.',
  /**
   * One configured `scan.referencePaths` entry resolved to a path that
   * does not exist on disk. Surfaced once per missing root so the
   * operator notices a typo without the walker silently swallowing it.
   */
  referenceWalkMissingRoot:
    'scan.referencePaths: configured path "{{path}}" does not exist; skipped.',

  /**
   * Active-provider bootstrap: filesystem auto-detect found no
   * markers (`.claude/`, `.codex/`, `AGENTS.md`, `.cursor/`) anywhere
   * under cwd or the effective scan roots. Plain-markdown projects
   * keep scanning fine; provider-specific extractors silently no-op
   * for this scan. Follows `context/cli-output-style.md` §3.1b
   * (two-line block, glyph + dim hint):
   *   - line 1: `{{glyph}}` (yellow `⚠`) + headline naming the
   *     missing markers,
   *   - line 2 (indent 3): `{{hint}}`, dim, names the consequence
   *     and the actionable next step.
   * Both the full block AND the bare hint are catalog-side so the
   * caller can wrap the hint in `ansi.dim(...)` without splitting
   * the template manually.
   */
  activeProviderNoMarkerWarning:
    '{{glyph}}  No provider markers detected (.claude/, .codex/, AGENTS.md, .cursor/).\n' +
    '   {{hint}}\n',
  activeProviderNoMarkerWarningHint:
    'Scanning as universal markdown only; provider-specific link types ' +
    '(e.g. claude @-directives, /-commands) will not appear. ' +
    'Set `activeProvider` in .skill-map/settings.json or install a provider plugin to enable them.',

  /**
   * Active-provider bootstrap: filesystem auto-detect found exactly
   * one marker and persisted the detected id to project settings.
   */
  activeProviderAutodetected:
    'Auto-detected activeProvider = {{id}} from filesystem markers; persisted to .skill-map/settings.json.',

  /**
   * Active-provider bootstrap: persistence of the auto-detected id
   * failed (permission, disk full, etc). Non-fatal; the scan
   * continues with the value in memory for this run.
   */
  activeProviderPersistFailed:
    'Auto-detected activeProvider = {{id}}, but persisting to .skill-map/settings.json failed: {{message}}. ' +
    'Run `sm config set activeProvider {{id}}` manually to make the choice sticky.',

  /**
   * Active-provider bootstrap: ambiguous detection (2+ markers
   * present), interactive prompt header. Follows
   * `context/cli-output-style.md` §3.2 (header + indented body):
   *   - `{{glyph}}` = warn glyph (`⚠`, yellow when colour is on);
   *     resolved at the call site, the catalog stays colour-free.
   *   - Header itself sentence-cased, no trailing period.
   *   - Options rendered with `activeProviderPromptOption` at indent 5
   *     so they associate visually with the glyph column.
   *   - Input prompt indented 2 so it reads as continuation of the
   *     header block.
   */
  activeProviderPromptHeader:
    '{{glyph}}  Multiple provider markers detected. Pick the active lens for this project:',
  activeProviderPromptOption: '     {{index}}) {{id}}',
  activeProviderPromptInput: '  Enter the number or provider id: ',

  /**
   * Active-provider bootstrap: ambiguous detection under `--yes`. The
   * caller exits 2 (`bad usage` per the spec); the rendered output
   * follows `context/cli-output-style.md` §3.1b (error with hint):
   *   - line 1: `{{glyph}}` (red `✕`) + headline naming the candidates,
   *   - line 2 (indent 3): `{{hint}}`, dim, the actionable next step.
   * Both the full block AND the bare hint string are catalog-side so
   * the caller can wrap the hint in `ansi.dim(...)` without splitting
   * the template manually.
   */
  activeProviderAmbiguousUnderYes:
    '{{glyph}}  Multiple provider markers detected ({{candidates}}) and --yes is set.\n' +
    '   {{hint}}\n',
  activeProviderAmbiguousUnderYesHint:
    'Set the lens explicitly with `sm config set activeProvider <id>` and re-run, or omit --yes for interactive selection.',

  /**
   * Active lens points at a bundle the operator has disabled (via
   * `sm plugins disable <id>` or the Settings UI). Classification keeps
   * running because it's provider-driven, but the lens-gated extractors
   * for the disabled bundle silently no-op. Without this warning the
   * graph quietly differs from what the lens implies.
   */
  activeProviderBundleDisabledWarning:
    'activeProvider = "{{id}}" but the "{{id}}" plugin bundle is currently disabled; ' +
    'provider-specific extractors will not run. ' +
    'Re-enable the bundle with `sm plugins enable {{id}}` or switch the lens with ' +
    '`sm config set activeProvider <id>` to silence this warning.',

  /**
   * Active-provider drift: the snapshot of provider markers persisted
   * when `activeProvider` was set (`activeProviderMarkers`) no longer
   * matches the freshly re-detected set on disk. The warn is
   * INFORMATIONAL and never blocks the scan; the run continues with
   * the cached lens. Follows `context/cli-output-style.md` §3.1b
   * (two-line block, glyph + dim hint):
   *   - line 1: `{{glyph}}` (yellow `⚠`) + headline naming the drift,
   *   - line 2 (indent 3): `{{hint}}`, dim, names the new / removed
   *     markers + the actionable next step.
   * Both the full block AND the bare hint string are catalog-side so
   * the caller can wrap the hint in `ansi.dim(...)` without splitting
   * the template manually. `{{added}}` / `{{removed}}` render as
   * comma-separated id lists, or `(none)` when one side is empty.
   * `{{currentLens}}` names the lens the scan is using right now so
   * the operator sees what they ARE using vs the alternatives.
   */
  activeProviderDriftWarn:
    '{{glyph}}  Provider markers changed since `activeProvider` was set.\n' +
    '   {{hint}}\n',
  activeProviderDriftWarnHint:
    'New: {{added}}. Removed: {{removed}}. Run `sm config set activeProvider <id>` to switch the lens, or keep using `{{currentLens}}`.',
} as const;
