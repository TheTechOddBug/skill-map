/**
 * `sm tutorial [variant] [--force]`, materialize an interactive tester
 * tutorial as a Claude Code skill folder under the current working
 * directory.
 *
 * The optional positional `variant` selects which skill gets
 * materialised:
 *
 *   - `tutorial` (default), writes `<cwd>/.claude/skills/sm-tutorial/`,
 *     the basic onboarding walkthrough.
 *   - `master`, writes `<cwd>/.claude/skills/sm-master/`, the advanced
 *     walkthrough (plugin tour, plugin authoring, settings + view-slots).
 *     Includes the `references/` sub-folder the skill reads at runtime.
 *
 * Companion to the `sm-tutorial` and `sm-master` Claude Code skills.
 * The flow is:
 *
 *   1. Tester drops into an empty directory.
 *   2. Tester runs `sm tutorial` or `sm tutorial master`. This verb
 *      writes the full skill directory under `<cwd>/.claude/skills/<slug>/`,
 *      sourced from the canonical folder shipped with `@skill-map/cli`.
 *   3. Tester opens Claude Code in the same directory. Claude Code
 *      auto-discovers `.claude/skills/<slug>/SKILL.md` and registers
 *      the skill formally, intra-skill relative paths like
 *      `references/tour-plugins.md` resolve against the skill
 *      directory automatically.
 *   4. Tester invokes the skill by speaking one of its trigger phrases
 *      (e.g. "tutorial maestro" for `sm-master`).
 *
 * Per spec § `sm tutorial`:
 *
 *   - Always writes the skill directory under `.claude/skills/`.
 *   - Refuses to clobber an existing skill directory unless `--force`.
 *   - Does NOT require an initialized `.skill-map/` project, the verb
 *     is a pre-bootstrap helper.
 *   - Exit `0` on success, `2` if the directory already exists without
 *     `--force`, on I/O failure, or on an invalid variant name.
 *
 * Skill source-of-truth folders: `.claude/skills/sm-tutorial/` and
 * `.claude/skills/sm-master/` at the repo root. The build pipeline
 * (`tsup.config.ts → onSuccess`) copies both recursively into
 * `dist/cli/tutorial/sm-tutorial/` / `dist/cli/tutorial/sm-master/` so
 * the published package ships them. The runtime resolver below walks
 * both layouts (dev source + bundled dist) following the same
 * multi-candidate pattern used by `loadBundledIgnoreText` in
 * `kernel/scan/ignore.ts`.
 */

import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command, Option } from 'clipanion';

import { tx } from '../../kernel/util/tx.js';
import { TUTORIAL_TEXTS } from '../i18n/tutorial.texts.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { ExitCode } from '../util/exit-codes.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { renderLogoBlock, resolveColorEnabled } from '../util/serve-banner.js';
import { SmCommand } from '../util/sm-command.js';
import { VERSION } from '../version.js';

type TutorialVariant = 'tutorial' | 'master';

const VALID_VARIANTS: readonly TutorialVariant[] = ['tutorial', 'master'] as const;
const DEFAULT_VARIANT: TutorialVariant = 'tutorial';

interface VariantSpec {
  /**
   * Skill slug. Used as the leaf directory name under
   * `<cwd>/.claude/skills/<slug>/`, also the leaf inside the bundled
   * `dist/cli/tutorial/<slug>/` and the repo-root source.
   */
  slug: string;
  /** Repo-relative path to the source-of-truth skill directory. */
  sourceDir: string;
  /**
   * Trigger phrase the tester reads in the success message. The
   * skill's frontmatter declares more triggers; we surface one per
   * language to give the operator a single, unambiguous starting line
   * they can copy-paste.
   */
  triggerEn: string;
  triggerEs: string;
}

const VARIANT_SPECS: Record<TutorialVariant, VariantSpec> = {
  tutorial: {
    slug: 'sm-tutorial',
    sourceDir: '.claude/skills/sm-tutorial',
    triggerEn: 'start the tutorial',
    triggerEs: 'arranquemos el tutorial',
  },
  master: {
    slug: 'sm-master',
    sourceDir: '.claude/skills/sm-master',
    triggerEn: 'advanced tutorial',
    triggerEs: 'tutorial maestro',
  },
};

export class TutorialCommand extends SmCommand {
  static override paths = [['tutorial']];
  static override usage = Command.Usage({
    category: 'Setup',
    description:
      'Materialize an interactive tester tutorial as a Claude Code skill folder under `<cwd>/.claude/skills/`.',
    details: `
      Drops the canonical skill directory (SKILL.md + any references/
      sub-folder) under \`<cwd>/.claude/skills/sm-tutorial/\` (default)
      or \`<cwd>/.claude/skills/sm-master/\` (when invoked as \`sm
      tutorial master\`). Claude Code auto-discovers the skill the
      next time it boots in this directory; the tester invokes it by
      speaking one of its trigger phrases.

      Does NOT require an initialized .skill-map/ project. Refuses to
      overwrite the target directory unless --force is passed. Valid
      values for the positional argument are: tutorial (default),
      master.
    `,
    examples: [
      ['Materialize the basic tutorial skill in the cwd', '$0 tutorial'],
      ['Materialize the advanced tutorial skill in the cwd', '$0 tutorial master'],
      ['Overwrite an existing target directory', '$0 tutorial --force'],
    ],
  });

  variant = Option.String({ required: false });

  force = Option.Boolean('--force', false, {
    description: 'Overwrite an existing target directory without prompting.',
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
    const targetDir = join(ctx.cwd, '.claude', 'skills', spec.slug);
    const targetDisplay = `.claude/skills/${spec.slug}/`;

    if (existsSync(targetDir) && !this.force) {
      this.printer!.error(
        tx(TUTORIAL_TEXTS.alreadyExists, {
          glyph: errGlyph,
          target: targetDisplay,
          cwd: stderrAnsi.dim(displayCwd(ctx.cwd)),
          hint: stderrAnsi.dim(TUTORIAL_TEXTS.alreadyExistsHint),
        }),
      );
      return ExitCode.Error;
    }

    let sourceDir: string;
    try {
      sourceDir = resolveSkillSourceDir(variant);
    } catch {
      this.printer!.error(
        tx(TUTORIAL_TEXTS.sourceMissing, {
          glyph: errGlyph,
          target: targetDisplay,
          hint: stderrAnsi.dim(TUTORIAL_TEXTS.sourceMissingHint),
        }),
      );
      return ExitCode.Error;
    }

    try {
      // Unconditional rm to keep the post-condition simple
      // (`targetDir` matches the bundled payload byte-for-byte). The
      // clobber guard above guarantees we only reach this point when
      // either the target does not exist OR `--force` was passed, so
      // wiping is always safe; `rmSync({ force: true })` is a no-op
      // on a missing path.
      rmSync(targetDir, { recursive: true, force: true });
      mkdirSync(dirname(targetDir), { recursive: true });
      cpSync(sourceDir, targetDir, { recursive: true });
    } catch (err) {
      this.printer!.error(
        tx(TUTORIAL_TEXTS.writeFailed, {
          glyph: errGlyph,
          target: targetDisplay,
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
        slug: spec.slug,
        target: targetDisplay,
        cwd: ansi.dim(displayCwd(ctx.cwd)),
        enLabel: ansi.dim(TUTORIAL_TEXTS.writtenLabelEn),
        esLabel: ansi.dim(TUTORIAL_TEXTS.writtenLabelEs),
        enTrigger: spec.triggerEn,
        esTrigger: spec.triggerEs,
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
// Bundled skill source resolver
// -----------------------------------------------------------------------------

const cachedSourceDirs: Map<TutorialVariant, string> = new Map();

/**
 * Resolve a variant's skill directory on disk. Walks a small list of
 * candidate locations relative to this module so the lookup works in
 * both:
 *
 *   - the dev layout (`src/cli/commands/tutorial.ts` → repo-root
 *     `.claude/skills/<slug>/`).
 *   - the bundled layout (single-file `dist/cli.js` → sibling
 *     `dist/cli/tutorial/<slug>/`, populated by tsup `onSuccess`).
 *
 * Throws if no candidate exists; the caller surfaces this as
 * `sourceMissing` with exit code 2. Result is cached so repeat
 * invocations in long-running processes (tests, watcher contexts)
 * don't re-stat disk.
 */
function resolveSkillSourceDir(variant: TutorialVariant): string {
  const cached = cachedSourceDirs.get(variant);
  if (cached !== undefined) return cached;
  const spec = VARIANT_SPECS[variant];
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dev: src/cli/commands/ → repo-root .claude/skills/<slug>/
    resolve(here, '../../..', spec.sourceDir),
    // bundled: dist/cli.js → dist/cli/tutorial/<slug> (sibling)
    resolve(here, 'cli/tutorial', spec.slug),
    // bundled fallback: any-depth → cli/tutorial/<slug>
    resolve(here, '../cli/tutorial', spec.slug),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      cachedSourceDirs.set(variant, candidate);
      return candidate;
    }
  }
  throw new Error(
    `skill source directory not found in any candidate location ` +
      `(last tried: ${candidates[candidates.length - 1]})`,
  );
}

/** Test-only, drop the cache so a unit test can simulate a missing dir. */
export function _resetTutorialCacheForTests(): void {
  cachedSourceDirs.clear();
}
