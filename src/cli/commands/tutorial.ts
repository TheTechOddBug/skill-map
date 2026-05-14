/**
 * `sm tutorial [variant] [--force]`, materialize an interactive tester
 * tutorial as a single `.md` file in the current working directory.
 *
 * The optional positional `variant` selects which Claude Code skill
 * gets materialised:
 *
 *   - `tutorial` (default), writes `<cwd>/sm-tutorial.md`, the basic
 *     onboarding walkthrough.
 *   - `master`, writes `<cwd>/sm-master.md`, the advanced walkthrough
 *     (plugin tour, plugin authoring, settings + view-slots).
 *
 * Companion to the `sm-tutorial` and `sm-master` Claude Code skills.
 * The flow is:
 *
 *   1. Tester drops into an empty directory.
 *   2. Tester runs `sm tutorial` or `sm tutorial master`. This verb
 *      writes the matching `.md` file under cwd, sourced from the
 *      canonical SKILL.md content shipped with `@skill-map/cli`.
 *   3. Tester opens Claude Code in that same directory and types
 *      `ejecutá @sm-tutorial.md` (or `@sm-master.md`), which loads
 *      the materialized file as a skill. Each SKILL ignores its own
 *      copy in its empty-dir whitelist (the file is its own onboarding
 *      payload, not a stale fixture).
 *
 * Per spec § `sm tutorial`:
 *
 *   - Always writes top-level (no subdirectory).
 *   - Refuses to clobber an existing target file unless `--force`.
 *   - Does NOT require an initialized `.skill-map/` project, the verb
 *     is a pre-bootstrap helper.
 *   - Exit `0` on success, `2` if the file already exists without
 *     `--force`, on I/O failure, or on an invalid variant name.
 *
 * SKILL.md sources of truth: `.claude/skills/sm-tutorial/SKILL.md` and
 * `.claude/skills/sm-master/SKILL.md` at the repo root. The build
 * pipeline (`tsup.config.ts → onSuccess`) copies both into
 * `dist/cli/tutorial/sm-tutorial.md` / `dist/cli/tutorial/sm-master.md`
 * so the published package ships them. The runtime resolver below
 * walks both layouts (dev source + bundled dist) following the same
 * multi-candidate pattern used by `loadBundledIgnoreText` in
 * `kernel/scan/ignore.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command, Option } from 'clipanion';

import { tx } from '../../kernel/util/tx.js';
import { TUTORIAL_TEXTS } from '../i18n/tutorial.texts.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { ExitCode } from '../util/exit-codes.js';
import { pathExists } from '../util/fs.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { renderLogoBlock, resolveColorEnabled } from '../util/serve-banner.js';
import { SmCommand } from '../util/sm-command.js';
import { VERSION } from '../version.js';

type TutorialVariant = 'tutorial' | 'master';

const VALID_VARIANTS: readonly TutorialVariant[] = ['tutorial', 'master'] as const;
const DEFAULT_VARIANT: TutorialVariant = 'tutorial';

interface VariantSpec {
  /** File name written to `<cwd>/`, also the bundled artifact name. */
  filename: string;
  /** Repo-relative path to the source-of-truth SKILL.md. */
  sourcePath: string;
  /** Bundled path inside `dist/cli/tutorial/`. */
  bundledName: string;
}

const VARIANT_SPECS: Record<TutorialVariant, VariantSpec> = {
  tutorial: {
    filename: 'sm-tutorial.md',
    sourcePath: '.claude/skills/sm-tutorial/SKILL.md',
    bundledName: 'sm-tutorial.md',
  },
  master: {
    filename: 'sm-master.md',
    sourcePath: '.claude/skills/sm-master/SKILL.md',
    bundledName: 'sm-master.md',
  },
};

export class TutorialCommand extends SmCommand {
  static override paths = [['tutorial']];
  static override usage = Command.Usage({
    category: 'Setup',
    description:
      'Materialize an interactive tester tutorial (sm-tutorial.md or sm-master.md) in the current directory.',
    details: `
      Drops the canonical SKILL.md content as ./sm-tutorial.md (default)
      or ./sm-master.md (when invoked as \`sm tutorial master\`) so a
      tester can open Claude Code in the cwd and load the file as a
      skill by typing "ejecutá @sm-tutorial.md" (or "@sm-master.md").
      Top-level only; no subdirectory is created.

      Does NOT require an initialized .skill-map/ project. Refuses to
      overwrite the target file unless --force is passed. Valid values
      for the positional argument are: tutorial (default), master.
    `,
    examples: [
      ['Materialize the basic tutorial in the cwd', '$0 tutorial'],
      ['Materialize the advanced tutorial in the cwd', '$0 tutorial master'],
      ['Overwrite an existing target file', '$0 tutorial --force'],
    ],
  });

  variant = Option.String({ required: false });

  force = Option.Boolean('--force', false, {
    description: 'Overwrite an existing target file without prompting.',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const stderr = this.context.stderr as NodeJS.WriteStream;
    const stderrAnsi = this.ansiFor('stderr');
    const errGlyph = stderrAnsi.red('✕');

    // Validate the positional argument against the closed catalog
    // before resolving anything else, an invalid variant is a usage
    // error and must not touch the filesystem.
    const rawVariant = this.variant;
    if (rawVariant !== undefined && !isTutorialVariant(rawVariant)) {
      this.printer!.error(
        tx(TUTORIAL_TEXTS.invalidVariant, {
          glyph: errGlyph,
          variant: rawVariant,
          hint: stderrAnsi.dim(TUTORIAL_TEXTS.invalidVariantHint),
        }),
      );
      return ExitCode.Error;
    }

    const variant: TutorialVariant = rawVariant ?? DEFAULT_VARIANT;
    const spec = VARIANT_SPECS[variant];
    const target = join(ctx.cwd, spec.filename);

    if ((await pathExists(target)) && !this.force) {
      this.printer!.error(
        tx(TUTORIAL_TEXTS.alreadyExists, {
          glyph: errGlyph,
          filename: spec.filename,
          cwd: stderrAnsi.dim(displayCwd(ctx.cwd)),
          hint: stderrAnsi.dim(TUTORIAL_TEXTS.alreadyExistsHint),
        }),
      );
      return ExitCode.Error;
    }

    let body: string;
    try {
      body = loadBundledTutorialText(variant);
    } catch {
      this.printer!.error(
        tx(TUTORIAL_TEXTS.sourceMissing, {
          glyph: errGlyph,
          filename: spec.filename,
          hint: stderrAnsi.dim(TUTORIAL_TEXTS.sourceMissingHint),
        }),
      );
      return ExitCode.Error;
    }

    try {
      await writeFile(target, body);
    } catch (err) {
      this.printer!.error(
        tx(TUTORIAL_TEXTS.writeFailed, {
          glyph: errGlyph,
          filename: spec.filename,
          message: formatErrorMessage(err),
        }),
      );
      return ExitCode.Error;
    }

    // Logo banner mirrors `sm serve`, same violet figlet + dim version
    // line, rendered to stderr so it stays out of any pipe consuming
    // stdout. Color resolved with the same precedence as serve.
    const colorEnabled = resolveColorEnabled({
      isTTY: stderr.isTTY === true,
      noColorFlag: this.noColor,
      env: process.env,
    });
    this.printer!.info(renderLogoBlock({ version: VERSION, colorEnabled }));

    const ansi = this.ansiFor('stdout');
    this.printer!.data(
      tx(TUTORIAL_TEXTS.written, {
        glyph: ansi.green('✓'),
        filename: spec.filename,
        cwd: ansi.dim(displayCwd(ctx.cwd)),
        enLabel: ansi.dim(TUTORIAL_TEXTS.writtenLabelEn),
        esLabel: ansi.dim(TUTORIAL_TEXTS.writtenLabelEs),
      }),
    );
    return ExitCode.Ok;
  }
}

function isTutorialVariant(value: string): value is TutorialVariant {
  return (VALID_VARIANTS as readonly string[]).includes(value);
}

/**
 * Render the cwd as `./<basename>/` so the user sees orienting info
 * without an absolute path eating the line. Falls back to `./` when
 * the cwd is the filesystem root (`/`), defensive, never observed.
 */
function displayCwd(cwd: string): string {
  const segments = cwd.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return './';
  return `./${segments[segments.length - 1]}/`;
}

// -----------------------------------------------------------------------------
// Bundled tutorial source loader
// -----------------------------------------------------------------------------

const cachedTutorials: Map<TutorialVariant, string> = new Map();

/**
 * Return the bundled SKILL.md text for the given variant. Cached after
 * first read so repeat invocations in long-running processes (tests,
 * watcher contexts) don't re-hit disk. Mirrors `loadBundledIgnoreText`
 * from `kernel/scan/ignore.ts`.
 *
 * Throws if the file cannot be located in any candidate path, the
 * caller surfaces this as `sourceMissing` with exit code 2.
 */
function loadBundledTutorialText(variant: TutorialVariant): string {
  const cached = cachedTutorials.get(variant);
  if (cached !== undefined) return cached;
  const body = readTutorialFromDisk(variant);
  cachedTutorials.set(variant, body);
  return body;
}

/** Test-only, drop the cache so a unit test can simulate a missing file. */
export function _resetTutorialCacheForTests(): void {
  cachedTutorials.clear();
}

/**
 * Resolve a variant's `SKILL.md` from disk. Walks a small list of
 * candidate locations relative to this module so the lookup works in
 * both:
 *
 *   - the dev layout (`src/cli/commands/tutorial.ts` → repo-root
 *     `.claude/skills/<slug>/SKILL.md`).
 *   - the bundled layout (single-file `dist/cli.js` → sibling
 *     `dist/cli/tutorial/<filename>.md`, populated by tsup `onSuccess`).
 *
 * The bundled filename intentionally differs from the source filename
 * so the published tarball ships each variant under the same name the
 * verb writes (`sm-tutorial.md` / `sm-master.md`), keeping `dist/`
 * self-explanatory for forensic inspection.
 */
function readTutorialFromDisk(variant: TutorialVariant): string {
  const spec = VARIANT_SPECS[variant];
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dev: src/cli/commands/ → repo-root .claude/skills/<slug>/SKILL.md
    resolve(here, '../../..', spec.sourcePath),
    // bundled: dist/cli.js → dist/cli/tutorial/<filename> (sibling)
    resolve(here, 'cli/tutorial', spec.bundledName),
    // bundled fallback: any-depth → cli/tutorial/<filename>
    resolve(here, '../cli/tutorial', spec.bundledName),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }
  throw new Error(`SKILL.md not found in any candidate location (last tried: ${candidates[candidates.length - 1]})`);
}
