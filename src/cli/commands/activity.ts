/**
 * `sm activity install <provider> [--yes]` / `sm activity uninstall <provider>`
 *
 * Live node activity wiring (normative contract:
 * `spec/provider-activity.md`; verb surface: `cli-contract.md`
 * §Activity). `install` writes the zero-dependency bridge artifact under
 * `.skill-map/activity/` and merges hook entries that spawn it into the
 * provider's PROJECT-LOCAL hook config, per the Provider's declarative
 * `activity.install` descriptor. `uninstall` reverses exactly that.
 *
 * Normative behaviors:
 *
 *   - **Consent-gated**: the merge modifies a file skill-map does not
 *     own, so a TTY y/N prompt names the exact target; `--yes` covers
 *     non-interactive runs; a non-TTY without `--yes` refuses (exit 2).
 *   - **Non-destructive + reversible**: pre-existing operator hooks are
 *     preserved; our entries carry the bridge path as marker and
 *     `uninstall` removes exactly them (see `core/activity/hooks-merge.ts`).
 *
 * The mechanics live in the shared engine (`core/activity/install.ts`),
 * also driven by the BFF's `/api/activity/install|uninstall` routes;
 * this file owns only the CLI chrome (consent prompt, texts, exits).
 *   - **Project-local only**: every path is joined onto the cwd; the
 *     provider's `configPath` is scope-relative by schema. `$HOME` is
 *     never touched, per the scope invariant.
 *   - Idempotent both ways: re-install and double-uninstall no-op with
 *     exit 0.
 *
 * Providers are resolved off the BUILT-IN registry: v1 ships the
 * `claude` adapter, and drop-in providers with runtime methods load
 * through the plugin runtime only at scan time. Extending the verb to
 * trusted drop-ins rides the same registry lookup later.
 */

import { Command, Option } from 'clipanion';

import type { IActivityInstallEvent, IProvider } from '../../kernel/extensions/index.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import {
  findActivityProvider,
  installActivityBridge,
  uninstallActivityBridge,
} from '../../core/activity/install.js';
import { builtIns } from '../../plugins/built-ins.js';
import { ACTIVITY_TEXTS } from '../i18n/activity.texts.js';
import { ACTIVITY_BRIDGE_REL } from '../util/db-path.js';
import { confirm } from '../util/confirm.js';
import { ExitCode } from '../util/exit-codes.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';

/** Built-in Providers that declare an activity adapter. */
function activityProviders(): IProvider[] {
  return builtIns().providers.filter((p) => p.activity !== undefined);
}

function resolveActivityProvider(id: string): IProvider | null {
  return findActivityProvider(builtIns().providers, id);
}

export class ActivityInstallCommand extends SmCommand {
  static override paths = [['activity', 'install']];
  static override usage = Command.Usage({
    category: 'Actions',
    description: 'Wire the live-activity bridge into a provider runtime’s project-local hook config.',
    details: `
      Writes the zero-dependency bridge script to
      \`.skill-map/activity/bridge.js\` and merges hook entries that
      spawn it into the provider's project-local hook config (for
      \`claude\`: \`.claude/settings.json\`). With \`sm serve\` running,
      the map then lights up each skill / agent / command node the
      moment the provider runtime invokes it.

      The merge is non-destructive (existing hooks are preserved) and
      exactly reversible via \`sm activity uninstall <provider>\`.
      Modifying the provider config is consent-gated: a TTY prompt
      names the target file; pass \`--yes\` for non-interactive runs.
    `,
    examples: [
      ['Wire Claude Code', '$0 activity install claude'],
      ['Non-interactive (CI / scripts)', '$0 activity install claude --yes'],
    ],
  });

  provider = Option.String({ required: true });
  yes = Option.Boolean('-y,--yes', false);

  protected async run(): Promise<number> {
    const ansi = this.ansiFor('stdout');
    const okGlyph = ansi.green('✓');
    const errGlyph = ansi.red('✕');

    const provider = resolveActivityProvider(this.provider);
    if (provider === null || provider.activity === undefined) {
      this.printUnknownProvider(errGlyph, ansi.dim.bind(ansi));
      return ExitCode.Error;
    }
    const install = provider.activity.install;
    const ctx = defaultRuntimeContext();
    const events: readonly IActivityInstallEvent[] = install.events ?? [];

    // Consent: both shapes write into territory skill-map does not own
    // (a vendor hooks file, or a plugin dir the runtime auto-loads).
    const consented = await this.ensureConsent(install.configPath, okGlyph, errGlyph);
    if (consented !== null) return consented;

    try {
      await installActivityBridge(ctx.cwd, provider);

      this.printer!.data(
        install.kind === 'plugin-file'
          ? tx(ACTIVITY_TEXTS.installedPlugin, {
              glyph: okGlyph,
              configPath: install.configPath,
            })
          : tx(ACTIVITY_TEXTS.installed, {
              glyph: okGlyph,
              bridgePath: ACTIVITY_BRIDGE_REL,
              configPath: install.configPath,
              events: events.length,
            }),
      );
      this.printer!.info(
        ansi.dim(
          tx(ACTIVITY_TEXTS.installedHint, { provider: sanitizeForTerminal(provider.id) }),
        ) + '\n',
      );
      return ExitCode.Ok;
    } catch (err) {
      this.printer!.error(
        tx(ACTIVITY_TEXTS.installFailed, {
          glyph: errGlyph,
          message: sanitizeForTerminal(formatErrorMessage(err)),
        }),
      );
      return ExitCode.Error;
    }
  }

  /**
   * Consent gate. Returns `null` to proceed, or the exit code to return
   * (declined / refused). `--yes` bypasses; a TTY asks y/N naming the
   * exact file; a non-TTY without `--yes` refuses with exit 2.
   */
  private async ensureConsent(
    configPath: string,
    okGlyph: string,
    errGlyph: string,
  ): Promise<number | null> {
    if (this.yes) return null;
    const stdin = this.context.stdin as NodeJS.ReadStream;
    if (stdin.isTTY !== true) {
      this.printer!.error(
        tx(ACTIVITY_TEXTS.installNeedsTty, { glyph: errGlyph, configPath }),
      );
      return ExitCode.Error;
    }
    const answer = await confirm(
      tx(ACTIVITY_TEXTS.installConfirm, { configPath }),
      { stdin, stderr: this.context.stderr },
    );
    if (answer) return null;
    this.printer!.info(tx(ACTIVITY_TEXTS.installDeclined, { glyph: okGlyph }));
    return ExitCode.Ok;
  }

  private printUnknownProvider(errGlyph: string, dim: (s: string) => string): void {
    const available = activityProviders()
      .map((p) => p.id)
      .join(', ');
    this.printer!.error(
      tx(ACTIVITY_TEXTS.unknownProvider, {
        glyph: errGlyph,
        provider: sanitizeForTerminal(this.provider),
      }),
    );
    this.printer!.error(
      dim(tx(ACTIVITY_TEXTS.unknownProviderHint, { providers: available || '(none)' })) + '\n',
    );
  }
}

export class ActivityUninstallCommand extends SmCommand {
  static override paths = [['activity', 'uninstall']];
  static override usage = Command.Usage({
    category: 'Actions',
    description: 'Remove the live-activity bridge wiring from a provider runtime’s hook config.',
    details: `
      Exactly reverses \`sm activity install <provider>\`: removes the
      skill-map hook entries (operator hooks stay untouched) and deletes
      the bridge artifact when no installed provider references it
      anymore. Idempotent: uninstalling a provider that was never
      installed is a no-op.
    `,
    examples: [['Unwire Claude Code', '$0 activity uninstall claude']],
  });

  provider = Option.String({ required: true });

  protected async run(): Promise<number> {
    const ansi = this.ansiFor('stdout');
    const okGlyph = ansi.green('✓');
    const errGlyph = ansi.red('✕');

    const provider = resolveActivityProvider(this.provider);
    if (provider === null || provider.activity === undefined) {
      this.printer!.error(
        tx(ACTIVITY_TEXTS.unknownProvider, {
          glyph: errGlyph,
          provider: sanitizeForTerminal(this.provider),
        }),
      );
      return ExitCode.Error;
    }
    const install = provider.activity.install;
    const ctx = defaultRuntimeContext();

    try {
      const { removed } = uninstallActivityBridge(ctx.cwd, provider);
      const pluginFile = install.kind === 'plugin-file';
      if (!removed) {
        this.printer!.info(
          tx(
            pluginFile ? ACTIVITY_TEXTS.nothingToUninstallPlugin : ACTIVITY_TEXTS.nothingToUninstall,
            { glyph: okGlyph, configPath: install.configPath },
          ),
        );
        return ExitCode.Ok;
      }

      this.printer!.data(
        pluginFile
          ? tx(ACTIVITY_TEXTS.uninstalledPlugin, {
              glyph: okGlyph,
              configPath: install.configPath,
            })
          : tx(ACTIVITY_TEXTS.uninstalled, {
              glyph: okGlyph,
              configPath: install.configPath,
              bridgePath: ACTIVITY_BRIDGE_REL,
            }),
      );
      return ExitCode.Ok;
    } catch (err) {
      this.printer!.error(
        tx(ACTIVITY_TEXTS.uninstallFailed, {
          glyph: errGlyph,
          message: sanitizeForTerminal(formatErrorMessage(err)),
        }),
      );
      return ExitCode.Error;
    }
  }
}

export const ACTIVITY_COMMANDS = [ActivityInstallCommand, ActivityUninstallCommand];
