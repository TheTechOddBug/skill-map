/**
 * Strings for the once-per-day "update available" banner emitted by
 * `cli/util/update-check-banner.ts` after every CLI verb. Two-line
 * block per `context/cli-output-style.md` §3.1b.
 *
 * `available` is the full block (glyph header + dim hint indented at
 * column 3); `availableHint` is the bare hint string the caller wraps
 * in `ansi.dim(...)` so a `--no-color` run reads the same bytes
 * modulo ANSI.
 */

export const UPDATE_CHECK_TEXTS = {
  available:
    '{{glyph}}  Update available: {{current}} → {{latest}}\n' +
    '   {{hint}}\n',
  availableHint: 'Run `npm i -g @skill-map/cli@latest` to update.',
} as const;
