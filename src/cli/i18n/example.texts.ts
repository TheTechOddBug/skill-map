/**
 * CLI strings emitted by `sm example`, `cli/commands/example.ts`.
 *
 * The verb materialises a ready-to-explore example project (the demo
 * "harness") directly into an empty cwd, so a new user can run `sm scan`
 * and `sm serve` against a real, pre-wired graph without authoring any
 * files first. It is the concrete counterpart to `sm tutorial` (which
 * installs the guided walkthrough skill instead of the finished
 * scenario). Takes no positional argument and no provider flag (the
 * example ships the Claude layout).
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const EXAMPLE_TEXTS = {
  // Success, written to stdout after the example project is created in
  // the cwd. The project ships unscanned (no `.skill-map/`), so the
  // next-steps block points the user at `sm scan` (provisions the
  // project and builds the graph) then `sm serve` (opens the map).
  written:
    '  {{glyph}}  Example project created in {{cwd}}\n' +
    '\n' +
    '  A small wired portfolio is ready to explore: a handbook\n' +
    '  (AGENTS.md) that mentions a content-editor agent and invokes a\n' +
    '  publish command, a check-links skill the command calls, and the\n' +
    '  docs they reference. Next:\n' +
    '\n' +
    '      {{scanGlyph}} sm scan    build the graph from these files\n' +
    '      {{serveGlyph}} sm serve   open the interactive map in the browser\n',
  writtenScanGlyph: '1)',
  writtenServeGlyph: '2)',

  // Refusal, the cwd is not empty and `--force` was not set. Goes to
  // stderr, exit code 2 (operational error per spec § Exit codes). The
  // example writes a self-contained project into the cwd, so it needs an
  // empty directory; the hint spells the two ways forward. Mirrors the
  // error shape: glyph + headline + dim hint.
  notEmpty:
    '{{glyph}}  sm example: the current directory is not empty (found {{entries}})\n' +
    '   {{hint}}\n',
  notEmptyHint:
    'sm example writes a self-contained project; run it in a fresh empty directory, or pass `--force` to use this one anyway (colliding files are overwritten).',

  // Unexpected positional argument. The verb takes none. Goes to
  // stderr, exit code 2. Mirrors the error shape: glyph + headline +
  // dim hint.
  unexpectedArg:
    "{{glyph}}  sm example: unexpected argument '{{arg}}'\n" +
    '   {{hint}}\n',
  unexpectedArgHint:
    'sm example takes no positional argument. Run `sm example` in an empty directory.',

  // I/O failure on write or on reading the bundled example payload.
  writeFailed: '{{glyph}}  sm example: failed to write the example project: {{message}}\n',
  sourceMissing:
    '{{glyph}}  sm example: could not read the bundled example payload from the install.\n' +
    '   {{hint}}\n',
  sourceMissingHint: 'Reinstall @skill-map/cli or report the bug.',
} as const;
