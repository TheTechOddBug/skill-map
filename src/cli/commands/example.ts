/**
 * `sm example [--force]`, materialize a ready-to-explore example project
 * (the demo "harness") directly into the current working directory, so a
 * new user can run `sm scan` and `sm serve` against a real, pre-wired
 * graph without authoring any files first.
 *
 * Concrete counterpart to `sm tutorial`: where `sm tutorial` installs the
 * guided walkthrough skill, `sm example` drops the finished scenario the
 * walkthrough builds toward, a small portfolio handbook (`AGENTS.md`)
 * that mentions a content-editor agent and invokes a publish command, a
 * `check-links` skill the command calls, and the deploy / style docs they
 * reference. It is the SAME harness the public demo renders, both consume
 * the single canonical fixture at `fixtures/demo-scope/`.
 *
 * Per spec § `sm example`:
 *
 *   - Writes the example project files directly into the cwd.
 *   - Does NOT write `.skill-map/`: the project ships unscanned, so the
 *     user's first `sm scan` provisions it fresh and auto-detects the
 *     lens from the on-disk markers. The `.skill-map/` of the source
 *     fixture is filtered out at copy time.
 *   - Requires the cwd to be empty (a listing including dotfiles returns
 *     nothing) unless `--force` (which proceeds, overwriting colliding
 *     files).
 *   - Does NOT require an initialized `.skill-map/` project; a
 *     pre-bootstrap helper that never reads project config.
 *   - Takes no positional argument.
 *   - Exit `0` on success, `2` if the directory is not empty without
 *     `--force`, on a stray positional, or on I/O failure (including a
 *     missing bundled payload).
 *
 * Payload source-of-truth: `fixtures/demo-scope/` at the repo root (the
 * same fixture the web demo scans). The build pipeline
 * (`tsup.config.ts → onSuccess`) copies it into `dist/cli/example/`
 * (minus its scan state) so the published package ships it. The runtime
 * resolver below walks both layouts (dev source + bundled dist) with the
 * same multi-candidate pattern `sm tutorial` uses.
 */

import { cpSync, existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command, Option } from 'clipanion';

import { tx } from '../../kernel/util/tx.js';
import { EXAMPLE_TEXTS } from '../i18n/example.texts.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { ExitCode } from '../util/exit-codes.js';
import { displayCwd, isDirEmpty, listCwdEntries } from '../util/empty-cwd.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { renderLogoBlock, resolveColorEnabled } from '../util/serve-banner.js';
import { SmCommand } from '../util/sm-command.js';
import { VERSION } from '../version.js';

/** Repo-relative path to the source-of-truth example payload. */
const EXAMPLE_SOURCE_DIR = 'fixtures/demo-scope';

export class ExampleCommand extends SmCommand {
  static override paths = [['example']];
  static override usage = Command.Usage({
    category: 'Setup',
    description:
      'Materialize a ready-to-explore example project (the demo harness) in the current directory.',
    details: `
      Writes a small wired portfolio into <cwd>: a handbook (AGENTS.md)
      that mentions a content-editor agent and invokes a publish command,
      a check-links skill the command calls, and the docs they reference.
      It is the same harness the public demo renders.

      Ships unscanned (no .skill-map/): run \`sm scan\` then \`sm serve\`
      to build and open the graph. Requires an empty directory; refuses a
      non-empty cwd (exit 2) unless --force. Takes no positional argument.
    `,
    examples: [
      ['Create the example project in the cwd', '$0 example'],
      ['Create it even if the directory is not empty', '$0 example --force'],
    ],
  });

  // The verb takes no positional argument. Accept one so a stray
  // `sm example foo` lands on a friendly usage error (guarded in
  // `run()`) instead of clipanion's generic "extraneous argument".
  legacyPositional = Option.String({ required: false });

  force = Option.Boolean('--force', false, {
    description: 'Overwrite colliding files in a non-empty directory without prompting.',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const stderr = this.context.stderr as NodeJS.WriteStream;
    const stderrAnsi = this.ansiFor('stderr');
    const errGlyph = stderrAnsi.red('✕');

    // The verb takes no positional argument.
    if (this.legacyPositional !== undefined) {
      this.printer!.error(
        tx(EXAMPLE_TEXTS.unexpectedArg, {
          glyph: errGlyph,
          arg: this.legacyPositional,
          hint: stderrAnsi.dim(EXAMPLE_TEXTS.unexpectedArgHint),
        }),
      );
      return ExitCode.Error;
    }

    // The example seeds a self-contained project into the cwd, so a
    // stray pre-existing file would make a later "rm -rf this dir"
    // unsafe. Enforce an empty cwd up front (unless --force).
    if (!this.force && !isDirEmpty(ctx.cwd)) {
      this.printer!.error(
        tx(EXAMPLE_TEXTS.notEmpty, {
          glyph: errGlyph,
          entries: listCwdEntries(ctx.cwd),
          hint: stderrAnsi.dim(EXAMPLE_TEXTS.notEmptyHint),
        }),
      );
      return ExitCode.Error;
    }

    let sourceDir: string;
    try {
      sourceDir = resolveExampleSourceDir();
    } catch {
      this.printer!.error(
        tx(EXAMPLE_TEXTS.sourceMissing, {
          glyph: errGlyph,
          hint: stderrAnsi.dim(EXAMPLE_TEXTS.sourceMissingHint),
        }),
      );
      return ExitCode.Error;
    }

    try {
      cpSync(sourceDir, ctx.cwd, {
        recursive: true,
        // Never copy the example's own scan state: the project must ship
        // unscanned so the user's first `sm scan` provisions it fresh.
        filter: (src) => isExamplePayloadEntry(sourceDir, src),
      });
    } catch (err) {
      this.printer!.error(
        tx(EXAMPLE_TEXTS.writeFailed, {
          glyph: errGlyph,
          message: formatErrorMessage(err),
        }),
      );
      return ExitCode.Error;
    }

    // Logo banner mirrors `sm serve` / `sm tutorial`, rendered to stderr
    // so it stays out of any pipe consuming stdout.
    const colorEnabled = resolveColorEnabled({
      isTTY: stderr.isTTY === true,
      noColorFlag: this.noColor,
      env: process.env,
    });
    this.printer!.info(renderLogoBlock({ version: VERSION, colorEnabled }));

    const ansi = this.ansiFor('stdout');
    this.printer!.data(
      tx(EXAMPLE_TEXTS.written, {
        glyph: ansi.green('✓'),
        cwd: ansi.dim(displayCwd(ctx.cwd)),
        scanGlyph: ansi.dim(EXAMPLE_TEXTS.writtenScanGlyph),
        serveGlyph: ansi.dim(EXAMPLE_TEXTS.writtenServeGlyph),
      }),
    );
    return ExitCode.Ok;
  }
}

// -----------------------------------------------------------------------------
// Bundled example payload resolver
// -----------------------------------------------------------------------------

let cachedSourceDir: string | undefined;

/**
 * Resolve the example payload directory on disk. Walks a small list of
 * candidate locations relative to this module so the lookup works in
 * both the dev layout (`src/cli/commands/example.ts` → repo-root
 * `fixtures/demo-scope/`) and the bundled layout (single-file
 * `dist/cli.js` → sibling `dist/cli/example/`, populated by tsup
 * `onSuccess`). Throws if no candidate exists; the caller surfaces this
 * as `sourceMissing` (exit 2). Result is cached so repeat invocations in
 * long-running processes (tests, watcher contexts) don't re-stat disk.
 */
function resolveExampleSourceDir(): string {
  if (cachedSourceDir !== undefined) return cachedSourceDir;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dev: src/cli/commands/ → repo-root fixtures/demo-scope/
    resolve(here, '../../..', EXAMPLE_SOURCE_DIR),
    // bundled: dist/cli.js → dist/cli/example (sibling)
    resolve(here, 'cli/example'),
    // bundled fallback: any-depth → cli/example
    resolve(here, '../cli/example'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      cachedSourceDir = candidate;
      return candidate;
    }
  }
  throw new Error(
    `example payload directory not found in any candidate location ` +
      `(last tried: ${candidates[candidates.length - 1]})`,
  );
}

/**
 * `cpSync` filter: copy every payload entry EXCEPT the source fixture's
 * own `.skill-map/` scan state. The dev source (`fixtures/demo-scope/`)
 * carries a populated `.skill-map/`; the bundled copy is already stripped
 * at build time, so this keeps both layouts producing an unscanned
 * project. `src` is an absolute path under `sourceRoot`.
 */
function isExamplePayloadEntry(sourceRoot: string, src: string): boolean {
  const rel = relative(sourceRoot, src);
  if (rel === '') return true; // the payload root itself
  return rel.split(/[\\/]/)[0] !== '.skill-map';
}

/** Test-only, drop the cache so a unit test can simulate a missing dir. */
export function _resetExampleCacheForTests(): void {
  cachedSourceDir = undefined;
}
