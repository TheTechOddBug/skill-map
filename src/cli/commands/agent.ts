/**
 * `sm agent install` / `sm agent uninstall` / `sm agent status`, the
 * distributable half of the agent process protocol (`spec/cli-contract.md`
 * §Agent process skill; protocol: `spec/job-lifecycle.md` §Runners).
 *
 * `install` materialises the canonical `sm-process-jobs` skill folder
 * (`core/agent-skill/skill-template.ts`, CLI-versioned, ships inside the
 * binary, no network fetch) into the destination Provider's
 * `scaffold.skillDir` under the cwd: `<skillDir>/sm-process-jobs/SKILL.md`.
 * Any agent runtime that reads that territory then learns the
 * claim → execute → record loop. `uninstall` removes exactly that folder;
 * `status` reports `installed` / `not installed` / `installed (stale)`,
 * where stale means the materialised bytes differ from this CLI's
 * canonical copy (an older install; a reinstall refreshes it).
 *
 * Destination selection is shared with `sm tutorial` (the
 * `listScaffoldTargets` catalog): only Providers that declare a
 * `scaffold.skillDir` are destinations, `--for <provider>` picks one
 * explicitly, and without `--for` the ACTIVE LENS decides
 * (`resolveActiveProvider`: persisted `activeProvider`, else the
 * filesystem marker auto-detect, else the open-standard default
 * `agent-skills`). A Provider without a skill directory is refused with
 * exit 2 and a directed advisory. When the target declares a
 * `scaffold.marker` (Codex's `.codex/`), install drops it alongside,
 * mirroring the tutorial, so a shared `.agents/skills` territory still
 * resolves the chosen lens.
 *
 * No DB gate: the skill materialises into the working tree and the
 * Provider catalog composes without a DB (built-ins, like `sm tutorial`),
 * so the verb family works pre-scan and pre-init. Idempotent both ways:
 * reinstall is three-state ("installed" / "updated" for an older
 * CLI's copy / "already up to date", nothing written), uninstalling an absent
 * skill no-ops with exit 0.
 */

import {
  agentSkillStatus,
  installAgentSkill,
  uninstallAgentSkill,
  type TInstallOutcome,
} from '../../core/agent-skill/engine.js';

import { Command, Option } from 'clipanion';

import {
  PROCESS_JOBS_SKILL_DIR,
  PROCESS_JOBS_SKILL_FILE,
} from '../../core/agent-skill/skill-template.js';
import { resolveActiveProvider } from '../../core/config/active-provider.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { builtIns } from '../../plugins/built-ins.js';
import { AGENT_TEXTS as T } from '../i18n/agent.texts.js';
import { ExitCode } from '../util/exit-codes.js';
import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import {
  listScaffoldTargets,
  type IScaffoldTarget,
} from '../../core/agent-skill/targets.js';

/** Relative display form of the skill folder (`<skillDir>/sm-process-jobs/`). */
function skillFolderDisplay(target: IScaffoldTarget): string {
  return `${target.skillDir}/${PROCESS_JOBS_SKILL_DIR}/`;
}

/** Relative display form of the skill file (`<skillDir>/sm-process-jobs/SKILL.md`). */
function skillFileDisplay(target: IScaffoldTarget): string {
  return `${target.skillDir}/${PROCESS_JOBS_SKILL_DIR}/${PROCESS_JOBS_SKILL_FILE}`;
}

/**
 * Shared base of the three verbs: the `--for` override plus the
 * destination resolution both `install`, `uninstall`, and `status` run
 * through, so the family can never fork its refusals.
 */
abstract class AgentBaseCommand extends SmCommand {
  // Named `forProvider`, NOT `for` (reserved word), mirroring
  // `sm tutorial`. The CLI surface stays `--for`.
  forProvider = Option.String('--for', {
    required: false,
    description: 'Destination provider id (e.g. claude). Overrides the active lens.',
  });

  /**
   * Resolve the destination Provider territory. Precedence:
   *
   *   1. `--for <id>`, matched against the scaffold-capable catalog
   *      (same matching as `sm tutorial`). A miss distinguishes a
   *      registered Provider without a `scaffold.skillDir` from a
   *      wholly unknown id; both refuse with exit 2.
   *   2. The active lens (`resolveActiveProvider`: persisted
   *      `activeProvider`, else marker auto-detect, else the
   *      open-standard default `agent-skills`). A lens without a skill
   *      directory refuses the same way.
   *
   * Returns `null` after printing the §3.1b error block (caller exits
   * `ExitCode.Error`).
   */
  protected resolveTarget(cwd: string): IScaffoldTarget | null {
    const targets = listScaffoldTargets();
    const stderrAnsi = this.ansiFor('stderr');
    const errGlyph = stderrAnsi.red('✕');
    const hint = stderrAnsi.dim(
      tx(T.skillDirHint, { ids: targets.map((t) => t.id).join(', ') }),
    );

    if (this.forProvider !== undefined) {
      const found = targets.find((t) => t.id === this.forProvider);
      if (found !== undefined) return found;
      const registered = builtIns().providers.some((p) => p.id === this.forProvider);
      this.printer!.error(
        tx(registered ? T.noSkillDir : T.forUnknown, {
          glyph: errGlyph,
          provider: sanitizeForTerminal(this.forProvider),
          hint,
        }),
      );
      return null;
    }

    const lens = resolveActiveProvider(cwd, builtIns().providers).resolved;
    const found = targets.find((t) => t.id === lens);
    if (found !== undefined) return found;
    this.printer!.error(
      tx(T.lensNoSkillDir, {
        glyph: errGlyph,
        provider: sanitizeForTerminal(lens),
        hint,
      }),
    );
    return null;
  }
}

export class AgentInstallCommand extends AgentBaseCommand {
  static override paths = [['agent', 'install']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Materialise the sm-process-jobs process skill into the lens’s skill directory.',
    details: `
      Writes the canonical \`sm-process-jobs\` skill folder (SKILL.md,
      shipped inside this CLI) under the destination Provider's skill
      directory (\`.claude/skills\` for Claude, \`.agents/skills\` for
      the open standard). Any agent booted in this directory then learns
      the queue process protocol: \`sm jobs claim --json\`, execute, close
      with \`sm record\`.

      The destination defaults to the active lens; \`--for <provider>\`
      overrides it. A Provider without a skill directory is refused
      (exit 2). Idempotent: reinstalling rewrites the folder in place,
      refreshing an older copy. Does NOT require an initialized
      \`.skill-map/\` project.
    `,
    examples: [
      ['Install for the active lens', '$0 agent install'],
      ['Install into Claude Code territory', '$0 agent install --for claude'],
    ],
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const target = this.resolveTarget(ctx.cwd);
    if (target === null) return ExitCode.Error;

    const outcome = this.materialise(ctx.cwd, target);
    if (outcome === null) return ExitCode.Error;
    this.reportInstall(outcome, target);
    return ExitCode.Ok;
  }

  /**
   * Write (or skip) the canonical skill. Three-state outcome: fresh
   * install, update (an older CLI's copy, bytes differ from the
   * canonical template), or already up to date (identical bytes,
   * nothing written). The `stale` probe of `sm agent status` uses the
   * same byte comparison, so "update available" and this verb's
   * "updated" always agree. `null` = IO failure (already reported).
   */
  private materialise(cwd: string, target: IScaffoldTarget): TInstallOutcome | null {
    try {
      // Engine call shared with the BFF's /api/agent/install surface;
      // the marker drop (e.g. Codex's `.codex/`) rides inside it.
      return installAgentSkill(cwd, target.skillDir, target.marker);
    } catch (err) {
      this.printer!.error(
        tx(T.installFailed, {
          glyph: this.ansiFor('stderr').red('✕'),
          message: sanitizeForTerminal(formatErrorMessage(err)),
        }),
      );
      return null;
    }
  }

  /** Success line per outcome; the next-step hint only when bytes moved. */
  private reportInstall(outcome: TInstallOutcome, target: IScaffoldTarget): void {
    const ansi = this.ansiFor('stdout');
    const line =
      outcome === 'installed' ? T.installed : outcome === 'updated' ? T.updated : T.upToDate;
    this.printer!.data(
      tx(line, {
        glyph: ansi.green('✓'),
        path: skillFileDisplay(target),
        provider: sanitizeForTerminal(target.id),
      }),
    );
    if (outcome !== 'up-to-date') {
      this.printer!.info(this.ansiFor('stderr').dim(T.installedHint) + '\n');
    }
  }
}

export class AgentUninstallCommand extends AgentBaseCommand {
  static override paths = [['agent', 'uninstall']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Remove the materialised sm-process-jobs process skill.',
    details: `
      Exactly reverses \`sm agent install\`: deletes the
      \`sm-process-jobs\` folder from the destination Provider's skill
      directory (active lens by default, \`--for <provider>\` overrides).
      Idempotent: when the skill is not installed, nothing happens and
      the verb exits 0 with an advisory.
    `,
    examples: [
      ['Uninstall for the active lens', '$0 agent uninstall'],
      ['Uninstall from Claude Code territory', '$0 agent uninstall --for claude'],
    ],
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const target = this.resolveTarget(ctx.cwd);
    if (target === null) return ExitCode.Error;

    let removed: boolean;
    try {
      removed = uninstallAgentSkill(ctx.cwd, target.skillDir);
    } catch (err) {
      this.printer!.error(
        tx(T.uninstallFailed, {
          glyph: this.ansiFor('stderr').red('✕'),
          message: sanitizeForTerminal(formatErrorMessage(err)),
        }),
      );
      return ExitCode.Error;
    }
    if (!removed) {
      this.printer!.info(
        tx(T.nothingToUninstall, {
          glyph: this.ansiFor('stderr').cyan('ℹ'),
          path: skillFolderDisplay(target),
        }),
      );
      return ExitCode.Ok;
    }
    this.printer!.data(
      tx(T.uninstalled, {
        glyph: this.ansiFor('stdout').green('✓'),
        path: skillFolderDisplay(target),
      }),
    );
    return ExitCode.Ok;
  }
}

export class AgentStatusCommand extends AgentBaseCommand {
  static override paths = [['agent', 'status']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Report the sm-process-jobs process skill install state for the lens.',
    details: `
      Read-only: reports \`installed\`, \`not installed\`, or
      \`installed (stale)\` for the destination Provider's skill
      directory (active lens by default, \`--for <provider>\` overrides).
      Stale means the materialised SKILL.md differs from this CLI's
      canonical copy (an older install); re-run \`sm agent install\` to
      refresh it. Exits 0 in all three states; the report is the result.
      \`--json\` emits \`{ provider, skillDir, installed, stale }\`.
    `,
    examples: [
      ['Status for the active lens', '$0 agent status'],
      ['Machine-readable status', '$0 agent status --for claude --json'],
    ],
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const target = this.resolveTarget(ctx.cwd);
    if (target === null) return ExitCode.Error;

    // Engine probe shared with the BFF status endpoint: byte-exact
    // comparison against the canonical constant, the same one install
    // reports as "updated".
    const { installed, stale } = agentSkillStatus(ctx.cwd, target.skillDir);

    if (this.json) {
      this.printer!.data(
        JSON.stringify({
          provider: target.id,
          skillDir: target.skillDir,
          installed,
          stale,
        }) + '\n',
      );
      return ExitCode.Ok;
    }

    const ansi = this.ansiFor('stdout');
    const provider = sanitizeForTerminal(target.id);
    if (!installed) {
      this.printer!.data(
        tx(T.statusNotInstalled, {
          glyph: ansi.dim('·'),
          provider,
          path: skillFolderDisplay(target),
        }),
      );
    } else if (stale) {
      this.printer!.data(
        tx(T.statusStale, {
          glyph: ansi.yellow('⚠'),
          provider,
          path: skillFileDisplay(target),
          hint: ansi.dim(T.statusStaleHint),
        }),
      );
    } else {
      this.printer!.data(
        tx(T.statusInstalled, {
          glyph: ansi.green('✓'),
          provider,
          path: skillFileDisplay(target),
        }),
      );
    }
    return ExitCode.Ok;
  }
}

export const AGENT_COMMANDS = [
  AgentInstallCommand,
  AgentUninstallCommand,
  AgentStatusCommand,
];
