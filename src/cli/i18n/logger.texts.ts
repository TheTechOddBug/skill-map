/**
 * Strings emitted by the CLI logger and its bootstrap parser.
 *
 * `invalidLevel` follows `context/cli-output-style.md` §3.1b (glyph +
 * headline + dim hint). It surfaces when `--log-level <value>` or
 * `SKILL_MAP_LOG_LEVEL=<value>` carries a value outside the closed
 * `LOG_LEVELS` set. The resolver keeps walking the source list, so the
 * line is a non-fatal advisory; yellow `⚠` is the matching glyph.
 */

export const LOGGER_TEXTS = {
  invalidLevel:
    '{{glyph}}  invalid log level "{{value}}".\n' +
    '   {{hint}}\n',
  invalidLevelHint: 'Expected one of: {{allowed}}.',
} as const;
