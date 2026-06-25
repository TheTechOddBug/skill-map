/**
 * `sm tutorial [--for <provider>] [--force]`, materialize the interactive
 * tester tutorial as a skill folder under the chosen agent's on-disk
 * territory in the current working directory.
 *
 * There is a single umbrella skill (slug `sm-tutorial`): the basic
 * onboarding walkthrough plus the advanced parts (plugin tour, plugin
 * authoring, settings + view-slots), selectable from the in-skill menu.
 * Its `references/` sub-folder (read at runtime) ships alongside.
 *
 * The destination directory is the selected Provider's
 * `scaffold.skillDir` (`.claude/skills` for Claude, `.agents/skills` for
 * the open standard). The mechanism is provider-agnostic; only Providers
 * that declare a `scaffold.skillDir` are destinations (today `claude` and
 * the stable open-standard `agent-skills`), and experimental ones are
 * filtered out unless `--experimental` is passed. Provider selection:
 *
 *   - `--for <provider-id>` picks it explicitly (validated against the
 *     scaffold-capable Providers, experimental ones gated by `--experimental`).
 *   - Without `--for` on an interactive stdin, the verb prompts with a
 *     numbered list (default: the first, Claude; empty answer accepts it).
 *     With only Claude selectable today, there is no prompt.
 *   - Without `--for` on a non-interactive stdin (pipes, CI), the verb
 *     picks the default Provider (Claude), so it stays scriptable.
 *
 * Companion to the `sm-tutorial` skill. The flow is:
 *
 *   1. Tester drops into an empty directory.
 *   2. Tester runs `sm tutorial` (optionally `--for <provider>`). This
 *      verb writes the full skill directory under
 *      `<cwd>/<skillDir>/sm-tutorial/`, sourced from the canonical
 *      folder shipped with `@skill-map/cli`.
 *   3. Tester opens their agent in the same directory. The agent
 *      auto-discovers `<skillDir>/sm-tutorial/SKILL.md` and registers the
 *      skill, intra-skill relative paths like `references/part-plugins.md`
 *      resolve against the skill directory automatically.
 *   4. Tester invokes the skill by speaking one of its trigger phrases
 *      and picks the advanced parts from the in-skill menu when ready.
 *
 * Per spec § `sm tutorial`:
 *
 *   - Writes the skill directory under the selected Provider's
 *     `scaffold.skillDir`.
 *   - Refuses to clobber an existing skill directory unless `--force`.
 *   - Does NOT require an initialized `.skill-map/` project, the verb is
 *     a pre-bootstrap helper. Provider selection reads the built-in
 *     Provider catalog directly, not project config.
 *   - Exit `0` on success, `2` if the directory already exists without
 *     `--force`, if `--for` names an unknown / non-scaffolding Provider,
 *     on I/O failure, or if a stray positional argument is passed.
 *
 * Skill source-of-truth folder: `.claude/skills/sm-tutorial/` at the
 * repo root (the repo itself is a Claude project, so the canonical
 * source lives there regardless of where a given invocation materialises
 * it). The build pipeline (`tsup.config.ts → onSuccess`) copies it
 * recursively into `dist/cli/tutorial/sm-tutorial/` so the published
 * package ships it. The runtime resolver below walks both layouts (dev
 * source + bundled dist) following the same multi-candidate pattern used
 * by `loadBundledIgnoreText` in `kernel/scan/ignore.ts`.
 */

import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { Command, Option } from 'clipanion';

import { tx } from '../../kernel/util/tx.js';
import { TUTORIAL_TEXTS } from '../i18n/tutorial.texts.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { builtIns } from '../../plugins/built-ins.js';
import { installedDefaultEnabled } from '../../kernel/config/plugin-resolver.js';
import type { IProvider } from '../../kernel/extensions/index.js';
import { type IAnsi } from '../util/ansi.js';
import { displayCwd, isDirEmpty, listCwdEntries } from '../util/empty-cwd.js';
import { ExitCode } from '../util/exit-codes.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { renderLogoBlock, resolveColorEnabled } from '../util/serve-banner.js';
import { SmCommand } from '../util/sm-command.js';
import { VERSION } from '../version.js';

/**
 * Skill slug. Used as the leaf directory name under
 * `<cwd>/.claude/skills/sm-tutorial/`, also the leaf inside the bundled
 * `dist/cli/tutorial/sm-tutorial/` and the repo-root source.
 */
const SKILL_SLUG = 'sm-tutorial';
/** Repo-relative path to the source-of-truth skill directory. */
const SKILL_SOURCE_DIR = '.claude/skills/sm-tutorial';
/**
 * Trigger phrases the tester reads in the success message. The skill's
 * frontmatter declares more triggers; we surface one per language to
 * give the operator a single, unambiguous starting line they can
 * copy-paste.
 */
const TRIGGER_EN = 'run the tutorial';
const TRIGGER_ES = 'ejecuta el tutorial';

export class TutorialCommand extends SmCommand {
  static override paths = [['tutorial']];
  static override usage = Command.Usage({
    category: 'Setup',
    description:
      'Materialize an interactive tester tutorial as a Claude Code skill folder under `<cwd>/.claude/skills/`.',
    details: `
      Drops the canonical skill directory (SKILL.md + its references/
      sub-folder) under \`<cwd>/.claude/skills/sm-tutorial/\`. Claude
      Code auto-discovers the skill the next time it boots in this
      directory; the tester invokes it by speaking one of its trigger
      phrases and picks the advanced parts from the in-skill menu.

      Does NOT require an initialized .skill-map/ project. Refuses to
      overwrite the target directory unless --force is passed. Takes no
      positional argument.

      By default only stable / beta providers are offered as destinations
      (today claude and the open-standard agent-skills). Pass --experimental
      to also offer experimental ones; they ship disabled, so enable the
      chosen one with \`sm plugins enable <id>\` before scanning under its lens.
    `,
    examples: [
      ['Materialize the tutorial skill in the cwd', '$0 tutorial'],
      ['Overwrite an existing target directory', '$0 tutorial --force'],
      ['Offer experimental providers as destinations', '$0 tutorial --experimental'],
    ],
  });

  // Legacy positional catcher: the verb takes no positional argument any
  // more. Accept one so a stale `sm tutorial master` lands on a friendly
  // usage error (guarded in `run()`) instead of clipanion's generic
  // "extraneous argument" message.
  legacyPositional = Option.String({ required: false });

  // Named `forProvider`, NOT `for` (reserved word). The CLI surface stays
  // `--for`; selects the destination Provider whose `scaffold.skillDir`
  // the skill is materialised under, skipping the interactive prompt.
  forProvider = Option.String('--for', {
    required: false,
    description: 'Destination provider id (e.g. claude). Skips the prompt.',
  });

  force = Option.Boolean('--force', false, {
    description: 'Overwrite an existing target directory without prompting.',
  });

  experimental = Option.Boolean('--experimental', false, {
    description:
      'Offer experimental providers as destinations. ' +
      'They ship disabled; enable the chosen one with `sm plugins enable <id>`.',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const stderr = this.context.stderr as NodeJS.WriteStream;
    const stderrAnsi = this.ansiFor('stderr');
    const errGlyph = stderrAnsi.red('✕');

    // Legacy guard: the verb no longer takes a positional argument. A
    // stale `sm tutorial master` (or any positional) is a usage error
    // and must not touch the filesystem.
    if (this.legacyPositional !== undefined) {
      this.printer!.error(
        tx(TUTORIAL_TEXTS.legacyPositional, {
          glyph: errGlyph,
          arg: this.legacyPositional,
          hint: stderrAnsi.dim(TUTORIAL_TEXTS.legacyPositionalHint),
        }),
      );
      return ExitCode.Error;
    }

    // The tutorial seeds a self-contained scenario into the cwd, and the
    // skill later lays its fixtures + `.skill-map/` there directly, so
    // the tester can delete the whole directory afterwards without
    // losing prior work. Enforce an empty cwd up front (unless --force)
    // so that promise holds: a stray `.claude/`, `notes/`, or source
    // file would make a later "rm -rf this dir" unsafe. `--force` is the
    // explicit escape for seeding into a directory that already holds
    // content. The clobber case (target skill folder already present) is
    // subsumed: an existing folder makes the cwd non-empty, so it trips
    // this guard too.
    if (!this.force && !isDirEmpty(ctx.cwd)) {
      this.printer!.error(
        tx(TUTORIAL_TEXTS.notEmpty, {
          glyph: errGlyph,
          entries: listCwdEntries(ctx.cwd),
          hint: stderrAnsi.dim(TUTORIAL_TEXTS.notEmptyHint),
        }),
      );
      return ExitCode.Error;
    }

    // Resolve which Provider territory to materialise into. The catalog
    // lists the scaffold-capable destinations (`claude` → `.claude/skills`,
    // the open-standard `agent-skills` → `.agents/skills`); experimental
    // ones join only under `--experimental`. Pre-bootstrap, so this reads
    // the built-in catalog directly and never touches `.skill-map/`.
    const targets = listScaffoldTargets(this.experimental);
    const target = await this.resolveScaffoldTarget(targets, stderrAnsi, errGlyph);
    if (target === null) return ExitCode.Error;
    // resolveScaffoldTarget only ever returns a selectable row, which
    // always carries a skillDir; this guard narrows the type.
    if (target.skillDir === undefined) {
      this.printer!.error(tx(TUTORIAL_TEXTS.noTargets, { glyph: errGlyph }));
      return ExitCode.Error;
    }

    const targetDir = join(ctx.cwd, target.skillDir, SKILL_SLUG);
    const targetDisplay = `${target.skillDir}/${SKILL_SLUG}/`;

    let sourceDir: string;
    try {
      sourceDir = resolveSkillSourceDir();
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
        slug: SKILL_SLUG,
        target: targetDisplay,
        provider: ansi.dim(target.label),
        cwd: ansi.dim(displayCwd(ctx.cwd)),
        enLabel: ansi.dim(TUTORIAL_TEXTS.writtenLabelEn),
        esLabel: ansi.dim(TUTORIAL_TEXTS.writtenLabelEs),
        enTrigger: TRIGGER_EN,
        esTrigger: TRIGGER_ES,
      }),
    );
    return ExitCode.Ok;
  }

  /**
   * Resolve the destination Provider. Precedence:
   *   1. `--for <id>` (validated against the scaffold-capable catalog).
   *   2. Interactive stdin → numbered prompt defaulting to Claude (the
   *      first entry); an empty answer accepts it.
   *   3. Non-interactive stdin → Claude (the first entry), so the verb
   *      stays scriptable.
   * The verb requires an empty cwd, so there is no marker to detect: the
   * default is always the first scaffold-capable Provider (Claude).
   * Returns `null` after printing an error (caller exits non-zero).
   */
  private async resolveScaffoldTarget(
    targets: readonly IScaffoldTarget[],
    stderrAnsi: IAnsi,
    errGlyph: string,
  ): Promise<IScaffoldTarget | null> {
    if (targets.length === 0) {
      // No Provider declares `scaffold.skillDir`. Should never happen
      // (claude always does), but fail loudly rather than guess.
      this.printer!.error(tx(TUTORIAL_TEXTS.noTargets, { glyph: errGlyph }));
      return null;
    }

    const requested = this.forProvider;
    if (requested !== undefined) {
      // `--for` matches a listed destination id. An experimental id only
      // appears in `targets` when `--experimental` was passed; otherwise
      // it falls through to the unknown-provider error.
      const found = targets.find((t) => t.id === requested);
      if (found === undefined) {
        this.printer!.error(
          tx(TUTORIAL_TEXTS.forUnknown, {
            glyph: errGlyph,
            provider: requested,
            hint: stderrAnsi.dim(
              tx(TUTORIAL_TEXTS.forUnknownHint, { ids: targets.map((t) => t.id).join(', ') }),
            ),
          }),
        );
        return null;
      }
      return found;
    }

    // No marker detection (the cwd is empty by contract): the default is
    // always the first destination Provider (Claude).
    const def = targets[0]!;

    // Non-interactive stdin (pipe, CI): take the default silently.
    const stdin = this.context.stdin as NodeJS.ReadStream;
    if (stdin.isTTY !== true) return def;

    const stderr = this.context.stderr as NodeJS.WriteStream;
    const picked = await promptForTarget(
      targets,
      def,
      stdin,
      stderr,
      stderrAnsi.yellow('?'),
    );
    if (picked === null) {
      this.printer!.error(
        tx(TUTORIAL_TEXTS.promptInvalid, {
          glyph: errGlyph,
          hint: stderrAnsi.dim(
            tx(TUTORIAL_TEXTS.forUnknownHint, { ids: targets.map((t) => t.id).join(', ') }),
          ),
        }),
      );
      return null;
    }
    return picked;
  }
}

// -----------------------------------------------------------------------------
// Destination Provider catalog
// -----------------------------------------------------------------------------

/**
 * One row in the tutorial destination prompt, projected from a built-in
 * Provider that declares a `scaffold.skillDir`. `id` is what `--for`
 * matches; `label` is the human name; `skillDir` is the territory the
 * skill folder lands under; `aka` lists the other agents that consume this
 * territory (display-only). Every row is a valid pick.
 */
interface IScaffoldTarget {
  id: string;
  label: string;
  skillDir: string;
  aka: readonly string[];
}

/**
 * Project one built-in Provider into a prompt row, or `null` when it is
 * not a scaffold destination. A Provider qualifies when it declares a
 * `scaffold.skillDir` (e.g. `claude`, `agent-skills`); the universal
 * `markdown` fallback declares none, so it is skipped. Experimental
 * Providers (`stability: experimental`, ships disabled) are only included
 * when `includeExperimental` is set (the `--experimental` flag); by
 * default they are omitted so the tutorial offers only ready destinations.
 * Split out of `listScaffoldTargets` to stay within the lint complexity
 * budget.
 */
function toScaffoldTarget(
  provider: IProvider,
  includeExperimental: boolean,
): IScaffoldTarget | null {
  const scaffold = provider.scaffold;
  if (!scaffold || !scaffold.skillDir) return null;
  if (!installedDefaultEnabled(provider.stability) && !includeExperimental) return null;
  return {
    id: provider.id,
    label: provider.presentation.label,
    skillDir: scaffold.skillDir,
    aka: scaffold.aka ?? [],
  };
}

/**
 * Prompt rows in catalog order (vendor providers first per the codegen
 * `PLUGIN_ORDER`, so `claude` leads). The tutorial is a pre-bootstrap
 * helper, so this reads the built-in catalog directly rather than project
 * config. When `includeExperimental` is set, experimental destinations
 * (today `agent-skills`) join the list; otherwise only ready ones appear.
 */
export function listScaffoldTargets(includeExperimental = false): IScaffoldTarget[] {
  const out: IScaffoldTarget[] = [];
  for (const provider of builtIns().providers) {
    const target = toScaffoldTarget(provider, includeExperimental);
    if (target !== null) out.push(target);
  }
  return out;
}

/** Render a target's prompt label, appending `(aka1, aka2)` when present. */
function labelWithAka(target: IScaffoldTarget): string {
  return target.aka.length > 0 ? `${target.label} (${target.aka.join(', ')})` : target.label;
}

/** Render the numbered destination list. */
function renderTargetLines(
  targets: readonly IScaffoldTarget[],
  def: IScaffoldTarget,
  glyph: string,
): string {
  const lines: string[] = [tx(TUTORIAL_TEXTS.promptHeader, { glyph })];
  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i]!;
    lines.push(
      tx(TUTORIAL_TEXTS.promptOption, {
        index: i + 1,
        label: labelWithAka(t),
        skillDir: `${t.skillDir}/`,
        marker: t.id === def.id ? TUTORIAL_TEXTS.promptDefaultMarker : '',
      }),
    );
  }
  return lines.join('\n');
}

/**
 * Resolve one trimmed answer to the row it names, `null` when
 * unrecognised. An empty answer accepts the default.
 */
export function classifyAnswer(
  trimmed: string,
  targets: readonly IScaffoldTarget[],
  def: IScaffoldTarget,
): IScaffoldTarget | null {
  if (trimmed === '') return def;
  const asNumber = Number.parseInt(trimmed, 10);
  const byIndex =
    !Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= targets.length
      ? targets[asNumber - 1]!
      : undefined;
  return byIndex ?? targets.find((t) => t.id.toLowerCase() === trimmed.toLowerCase()) ?? null;
}

/**
 * Numbered-list interactive prompt for the destination Provider. Every
 * listed row is a valid pick. `def` is pre-selected (an empty answer
 * accepts it). Returns the picked target, or `null` when the operator
 * gives no valid pick within the attempt budget (caller surfaces
 * `promptInvalid` and exits non-zero).
 */
async function promptForTarget(
  targets: readonly IScaffoldTarget[],
  def: IScaffoldTarget,
  stdin: NodeJS.ReadStream,
  stderr: NodeJS.WriteStream,
  glyph: string,
): Promise<IScaffoldTarget | null> {
  stderr.write(renderTargetLines(targets, def, glyph) + '\n');
  const defIndex = targets.findIndex((t) => t.id === def.id);
  const rl = createInterface({ input: stdin, output: stderr });
  try {
    // Bounded re-ask: an unrecognised answer re-asks. The cap stops a
    // piped / EOF stdin from looping forever.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const answer = await new Promise<string>((resolveP) =>
        rl.question(tx(TUTORIAL_TEXTS.promptInput, { index: defIndex + 1 }), resolveP),
      );
      const result = classifyAnswer(answer.trim(), targets, def);
      if (result !== null) return result;
    }
    return null;
  } finally {
    rl.close();
  }
}

// -----------------------------------------------------------------------------
// Bundled skill source resolver
// -----------------------------------------------------------------------------

let cachedSourceDir: string | undefined;

/**
 * Resolve the skill directory on disk. Walks a small list of candidate
 * locations relative to this module so the lookup works in both:
 *
 *   - the dev layout (`src/cli/commands/tutorial.ts` → repo-root
 *     `.claude/skills/sm-tutorial/`).
 *   - the bundled layout (single-file `dist/cli.js` → sibling
 *     `dist/cli/tutorial/sm-tutorial/`, populated by tsup `onSuccess`).
 *
 * Throws if no candidate exists; the caller surfaces this as
 * `sourceMissing` with exit code 2. Result is cached so repeat
 * invocations in long-running processes (tests, watcher contexts)
 * don't re-stat disk.
 */
function resolveSkillSourceDir(): string {
  if (cachedSourceDir !== undefined) return cachedSourceDir;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dev: src/cli/commands/ → repo-root .claude/skills/sm-tutorial/
    resolve(here, '../../..', SKILL_SOURCE_DIR),
    // bundled: dist/cli.js → dist/cli/tutorial/sm-tutorial (sibling)
    resolve(here, 'cli/tutorial', SKILL_SLUG),
    // bundled fallback: any-depth → cli/tutorial/sm-tutorial
    resolve(here, '../cli/tutorial', SKILL_SLUG),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      cachedSourceDir = candidate;
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
  cachedSourceDir = undefined;
}
