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
 *     `uninstall` removes exactly them (see `activity-hooks-merge.ts`).
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

import { mkdir, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Command, Option } from 'clipanion';

import type { IActivityInstallEvent, IProvider } from '../../kernel/extensions/index.js';
import { readJsonObjectOrEmpty, writeJsonAtomic } from '../../kernel/util/atomic-write.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { builtIns } from '../../plugins/built-ins.js';
import { ACTIVITY_TEXTS } from '../i18n/activity.texts.js';
import {
  ACTIVITY_BRIDGE_REL,
  defaultActivityBridgePath,
  defaultProjectActivityDir,
} from '../util/db-path.js';
import { BRIDGE_PACKAGE_JSON, renderActivityBridge } from '../util/activity-bridge.js';
import { mergeActivityHooks, removeActivityHooks } from '../util/activity-hooks-merge.js';
import { confirm } from '../util/confirm.js';
import { ExitCode } from '../util/exit-codes.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';

/** Command the provider's hook config spawns per event: `node <bridge> <provider>`. */
function bridgeCommand(providerId: string): string {
  return `node ${ACTIVITY_BRIDGE_REL} ${providerId}`;
}

/**
 * REFRESH semantics for the provider config: drop our marker-carrying
 * entries first, then re-add from the CURRENT descriptor. A plain
 * idempotency check would freeze stale entries in place (an older
 * install's event list / matchers would never pick up descriptor
 * changes); the remove+merge pair updates ours while leaving operator
 * hooks untouched either way. Persists only when something changed.
 */
function refreshHookWiring(
  configPath: string,
  events: readonly IActivityInstallEvent[],
  providerId: string,
): void {
  const settings = readJsonObjectOrEmpty(configPath);
  const removedStale = removeActivityHooks(settings, ACTIVITY_BRIDGE_REL);
  const merge = mergeActivityHooks(settings, events, bridgeCommand(providerId), ACTIVITY_BRIDGE_REL);
  if (removedStale || merge.changed) {
    writeJsonAtomic(configPath, settings);
  }
}

/** Built-in Providers that declare an activity adapter. */
function activityProviders(): IProvider[] {
  return builtIns().providers.filter((p) => p.activity !== undefined);
}

function resolveActivityProvider(id: string): IProvider | null {
  return activityProviders().find((p) => p.id === id) ?? null;
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
    if (install.kind !== 'json-hooks') {
      this.printer!.error(
        tx(ACTIVITY_TEXTS.installKindUnsupported, {
          glyph: errGlyph,
          provider: sanitizeForTerminal(provider.id),
          kind: install.kind,
        }),
      );
      return ExitCode.Error;
    }

    const ctx = defaultRuntimeContext();
    const configPath = join(ctx.cwd, install.configPath);
    const bridgePath = defaultActivityBridgePath(ctx.cwd);
    const events: readonly IActivityInstallEvent[] = install.events ?? [];

    // Consent: the merge touches a file skill-map does not own.
    const consented = await this.ensureConsent(install.configPath, okGlyph, errGlyph);
    if (consented !== null) return consented;

    try {
      refreshHookWiring(configPath, events, provider.id);

      // The bridge artifact is (re)written on every install, so a
      // version upgrade refreshes the script. The sibling package.json
      // pins CommonJS so an ESM host project (`"type": "module"`)
      // cannot break the bridge's `require`.
      await mkdir(dirname(bridgePath), { recursive: true });
      await writeFile(bridgePath, renderActivityBridge(), 'utf8');
      await writeFile(join(dirname(bridgePath), 'package.json'), BRIDGE_PACKAGE_JSON, 'utf8');

      this.printer!.data(
        tx(ACTIVITY_TEXTS.installed, {
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
    const configPath = join(ctx.cwd, install.configPath);

    try {
      const settings = readJsonObjectOrEmpty(configPath);
      const changed = removeActivityHooks(settings, ACTIVITY_BRIDGE_REL);
      if (!changed) {
        this.printer!.info(
          tx(ACTIVITY_TEXTS.nothingToUninstall, { glyph: okGlyph, configPath: install.configPath }),
        );
        return ExitCode.Ok;
      }
      writeJsonAtomic(configPath, settings);

      // v1 ships a single provider; when multi-provider installs land,
      // this becomes "delete only when no OTHER provider's config still
      // references the bridge". The whole activity dir is skill-map's
      // own artifact (bridge + its type-pinning package.json).
      rmSync(defaultProjectActivityDir(ctx.cwd), { recursive: true, force: true });

      this.printer!.data(
        tx(ACTIVITY_TEXTS.uninstalled, {
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
