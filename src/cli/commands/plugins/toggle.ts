/**
 * `sm plugins enable <id>...` / `sm plugins disable <id>...`, flip
 * the persisted enable-state for one or more plugins (or every
 * plugin via `--all`).
 *
 * Writes to `config_plugins`, which takes precedence over the
 * team-shared baseline at `settings.json#/plugins/<id>/enabled`. On
 * disable, also purges persisted `scan_contributions` rows so the UI
 * stops rendering the plugin's footer/card chips before the next
 * scan.
 *
 * Granularity is enforced per Spec § A.7:
 *
 *   - granularity=bundle plugins (most user plugins, the built-in
 *     `claude` bundle) accept only the bundle id. A qualified id
 *     `<bundle>/<ext>` is rejected with a directed message.
 *   - granularity=extension bundles (`core`) accept only qualified
 *     ids. The bare bundle id is rejected so the user does not flip
 *     the entire `core` family at once.
 *
 * `--all` operates on bundle ids only (skips granularity=extension);
 * the real "disable every core extension" intent is served by
 * `--no-built-ins` on `sm scan`.
 */

import { Command, Option } from 'clipanion';

import { builtInBundles } from '../../../plugins/built-ins.js';
import { isPluginLocked } from '../../../kernel/config/locked-plugins.js';
import { qualifiedExtensionId } from '../../../kernel/registry.js';
import type {
  IDiscoveredPlugin,
  TGranularity,
} from '../../../kernel/types/plugin.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import type { IAnsi } from '../../util/ansi.js';
import { resolveDbPath } from '../../util/db-path.js';
import { ExitCode } from '../../util/exit-codes.js';
import { defaultRuntimeContext } from '../../util/runtime-context.js';
import { SmCommand } from '../../util/sm-command.js';
import { withSqlite } from '../../util/with-sqlite.js';
import { loadAll } from './shared.js';

interface IBundleSlim {
  id: string;
  granularity: TGranularity;
  extensionIds: string[];
}

interface IResolvedTarget {
  /**
   * The key written to `config_plugins.plugin_id`. For bundle
   * granularity this is the bundle id; for extension granularity it's
   * the qualified id `<bundle>/<ext>`.
   */
  key: string;
}

abstract class TogglePluginsBase extends SmCommand {
  all = Option.Boolean('--all', false);
  ids = Option.Rest({ name: 'ids' });

  protected async toggle(enabled: boolean): Promise<number> {
    const verb = enabled ? 'enable' : 'disable';
    const stderrAnsi = this.ansiFor('stderr');

    const argError = this.#validateArgs(stderrAnsi, verb);
    if (argError !== null) return argError;

    const plugins = await loadAll({ pluginDir: undefined });
    const catalogue = bundleCatalogue(plugins);

    const targetsResult = this.#pickTargets(catalogue, verb, stderrAnsi);
    if (typeof targetsResult === 'number') return targetsResult;
    let targets = targetsResult;

    const lockError = this.#applyLockGate(targets, stderrAnsi);
    if (typeof lockError === 'number') return lockError;
    targets = lockError;

    await this.#persistTargets(targets, enabled);
    this.#renderSuccess(targets, enabled);
    return ExitCode.Ok;
  }

  /**
   * `--all` vs `<id>...` mutex check. The two are mutually exclusive
   * and one must be present; surfaces a directed error on misuse.
   * Variadic positional accepts one or more ids.
   */
  #validateArgs(ansi: IAnsi, verb: string): number | null {
    const errGlyph = ansi.red('✕');
    if (this.all && this.ids.length > 0) {
      this.printer!.error(
        tx(PLUGINS_TEXTS.toggleBothIdAndAll, {
          glyph: errGlyph,
          hint: ansi.dim(tx(PLUGINS_TEXTS.toggleBothIdAndAllHint, { verb })),
        }),
      );
      return ExitCode.Error;
    }
    if (!this.all && this.ids.length === 0) {
      this.printer!.error(
        tx(PLUGINS_TEXTS.toggleNeitherIdNorAll, {
          glyph: errGlyph,
          hint: ansi.dim(tx(PLUGINS_TEXTS.toggleNeitherIdNorAllHint, { verb })),
        }),
      );
      return ExitCode.Error;
    }
    return null;
  }

  /**
   * Resolve `<id>...` against the catalogue or fan out via `--all`.
   * Returns the target list on success, or the exit code on a
   * directed-error path (unknown id, granularity mismatch).
   *
   * `--all` is a macro on bundle ids: every plugin / bundle the user
   * can see. We deliberately do NOT expand to qualified
   * <bundle>/<ext> keys, that would silently flip a granularity
   * policy. For granularity=extension bundles the user already hits
   * the directed error message when they try the bundle id directly,
   * so `--all` skips them here too and the real "disable every core
   * extension" intent is served by `--no-built-ins` on `sm scan`.
   *
   * Variadic mode is all-or-nothing: the first bad id aborts the
   * batch before any DB write, so the user never lands in a partial
   * state. Repeated ids in the same call are deduped.
   */
  #pickTargets(catalogue: IBundleSlim[], verb: 'enable' | 'disable', ansi: IAnsi): string[] | number {
    if (this.all) {
      return catalogue.filter((b) => b.granularity === 'bundle').map((b) => b.id);
    }
    const keys: string[] = [];
    for (const rawId of this.ids) {
      const resolved = resolveToggleTarget(rawId, catalogue, verb, ansi);
      if ('error' in resolved) {
        this.printer!.error(tx(PLUGINS_TEXTS.toggleResolveError, { error: resolved.error }));
        // Granularity errors and unknown ids are both user input
        // problems, exit 5 (NotFound) keeps the existing contract for
        // "you asked me to act on something I cannot resolve".
        return ExitCode.NotFound;
      }
      keys.push(resolved.key);
    }
    return [...new Set(keys)];
  }

  /**
   * Host lock, see `src/kernel/config/locked-plugins.ts`. Bulk modes
   * (`--all` or an explicit batch of >1 ids) silently skip locked
   * targets so the user can still toggle the rest. Single-id mode
   * surfaces a directed exit-5 message so the user knows their one
   * intended target was refused.
   */
  #applyLockGate(targets: string[], ansi: IAnsi): string[] | number {
    if (this.all || this.ids.length > 1) return targets.filter((id) => !isPluginLocked(id));
    const lockedHit = targets.find((id) => isPluginLocked(id));
    if (!lockedHit) return targets;
    this.printer!.error(
      tx(PLUGINS_TEXTS.pluginLocked, {
        glyph: ansi.red('✕'),
        id: sanitizeForTerminal(lockedHit),
        hint: ansi.dim(PLUGINS_TEXTS.pluginLockedHint),
      }),
    );
    return ExitCode.NotFound;
  }

  /**
   * Persist the toggle in `config_plugins`. On disable, also purge
   * the plugin's `scan_contributions` rows immediately (matches the
   * BFF route, see `server/routes/plugins.ts:applyChangeToAdapter`).
   * `targets` carries either a bare bundle id (e.g. `claude`) or a
   * qualified `<bundle>/<ext>` (e.g. `core/slash`); the split mirrors
   * how the catalog sweep groups rows.
   */
  async #persistTargets(targets: string[], enabled: boolean): Promise<void> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: undefined, cwd: ctx.cwd });
    await withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      for (const id of targets) {
        await adapter.pluginConfig.set(id, enabled);
        if (!enabled) await purgeContributionsFor(adapter, id);
      }
    });
  }

  #renderSuccess(targets: string[], enabled: boolean): void {
    const verbPast = enabled ? 'enabled' : 'disabled';
    if (targets.length === 1) {
      this.printer!.data(tx(PLUGINS_TEXTS.toggleAppliedSingle, { verbPast, id: targets[0]! }));
    } else {
      this.printer!.data(
        tx(PLUGINS_TEXTS.toggleAppliedManyHeader, { verbPast, count: targets.length }),
      );
      for (const id of targets) {
        this.printer!.data(tx(PLUGINS_TEXTS.toggleAppliedManyRow, { id }));
      }
    }
  }
}

async function purgeContributionsFor(
  adapter: Parameters<Parameters<typeof withSqlite>[1]>[0],
  id: string,
): Promise<void> {
  const slash = id.indexOf('/');
  if (slash < 0) {
    await adapter.contributions.purgeByPlugin(id);
    return;
  }
  await adapter.contributions.purgeByPlugin(id.slice(0, slash), id.slice(slash + 1));
}

export class PluginsEnableCommand extends TogglePluginsBase {
  static override paths = [['plugins', 'enable']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Enable one or more plugins (or --all). Persists in config_plugins.',
    details: `
      Writes a row to config_plugins with enabled=1 per id. Takes
      precedence over the team-shared baseline at
      settings.json#/plugins/<id>/enabled. Use sm plugins disable to
      flip; sm config reset plugins.<id>.enabled drops the settings.json
      baseline.

      Accepts one or more ids in one call, e.g.
      'sm plugins enable claude antigravity openai'. Batches are
      all-or-nothing: a single unknown / mismatched id aborts before
      any write. Repeated ids are deduped. Locked plugins inside a
      batch are silently skipped.

      Granularity: a bundle-granularity plugin (default for user plugins,
      and the built-in 'claude' bundle) accepts only the bundle id. An
      extension-granularity plugin (the built-in 'core' bundle) accepts
      only qualified ids '<bundle>/<ext-id>'. Mismatches are rejected
      with directed guidance.
    `,
  });

  protected async run(): Promise<number> {
    return this.toggle(true);
  }
}

export class PluginsDisableCommand extends TogglePluginsBase {
  static override paths = [['plugins', 'disable']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Disable one or more plugins (or --all). Persists in config_plugins; does not delete files.',
    details: `
      Writes a row to config_plugins with enabled=0 per id. Discovery
      still surfaces the plugin in sm plugins list, but with
      status=disabled; its extensions are not imported and the kernel
      will not run them.

      Accepts one or more ids in one call, e.g.
      'sm plugins disable antigravity openai agent-skills'. Batches are
      all-or-nothing: a single unknown / mismatched id aborts before
      any write. Repeated ids are deduped. Locked plugins inside a
      batch are silently skipped.

      Granularity: a bundle-granularity plugin (default for user plugins,
      and the built-in 'claude' bundle) accepts only the bundle id. An
      extension-granularity plugin (the built-in 'core' bundle) accepts
      only qualified ids '<bundle>/<ext-id>'. Mismatches are rejected
      with directed guidance.
    `,
  });

  protected async run(): Promise<number> {
    return this.toggle(false);
  }
}

/**
 * Build the canonical bundle catalogue: built-ins first, then any
 * loaded user plugins. Used by `resolveToggleTarget` to validate
 * `<id>` against the granularity declared on the owning bundle.
 *
 * Plugins whose manifest never validated (`invalid-manifest` /
 * `load-error` without a manifest) are still listed so the user can
 * disable a buggy plugin to silence its load error, but their
 * `granularity` falls back to `'bundle'` (the safe default that the
 * loader would inject if the manifest were repaired).
 */
function bundleCatalogue(plugins: IDiscoveredPlugin[]): IBundleSlim[] {
  const out: IBundleSlim[] = [];
  for (const bundle of builtInBundles) {
    out.push({
      id: bundle.id,
      granularity: bundle.granularity,
      extensionIds: bundle.extensions.map((e) => e.id),
    });
  }
  for (const p of plugins) {
    out.push({
      id: p.id,
      granularity: p.granularity ?? 'bundle',
      extensionIds: p.extensions?.map((e) => e.id) ?? [],
    });
  }
  return out;
}

/**
 * Resolve a user-supplied `<id>` (either a plugin id or a qualified
 * extension id) against the catalogue. Returns either a usable `key`
 * to persist, or a directed error message that explains why the id
 * was rejected (granularity mismatch, unknown bundle, unknown
 * extension under a known bundle).
 *
 * Split internally into two paths (qualified vs bare) so each branch
 * is small enough to stay under the lint cap without an
 * `eslint-disable`.
 */
function resolveToggleTarget(
  id: string,
  catalogue: IBundleSlim[],
  verb: 'enable' | 'disable',
  ansi: IAnsi,
): IResolvedTarget | { error: string } {
  return id.includes('/')
    ? resolveQualifiedToggle(id, catalogue, verb, ansi)
    : resolveBareToggle(id, catalogue, verb, ansi);
}

function resolveQualifiedToggle(
  id: string,
  catalogue: IBundleSlim[],
  verb: 'enable' | 'disable',
  ansi: IAnsi,
): IResolvedTarget | { error: string } {
  const errGlyph = ansi.red('✕');
  const [bundleId, extId, ...rest] = id.split('/');
  if (!bundleId || !extId || rest.length > 0) {
    return {
      error: tx(PLUGINS_TEXTS.qualifiedIdUnknownBundle, {
        glyph: errGlyph,
        bundleId: sanitizeForTerminal(id),
        hint: ansi.dim(PLUGINS_TEXTS.qualifiedIdUnknownBundleHint),
      }),
    };
  }
  const bundle = catalogue.find((b) => b.id === bundleId);
  if (!bundle) {
    return {
      error: tx(PLUGINS_TEXTS.qualifiedIdUnknownBundle, {
        glyph: errGlyph,
        bundleId: sanitizeForTerminal(bundleId),
        hint: ansi.dim(PLUGINS_TEXTS.qualifiedIdUnknownBundleHint),
      }),
    };
  }
  if (bundle.granularity === 'bundle') {
    return {
      error: tx(PLUGINS_TEXTS.granularityBundleRejectsQualified, {
        glyph: errGlyph,
        bundleId: sanitizeForTerminal(bundleId),
        extId: sanitizeForTerminal(extId),
        verb,
        hint: ansi.dim(PLUGINS_TEXTS.granularityBundleRejectsQualifiedHint),
      }),
    };
  }
  if (!bundle.extensionIds.includes(extId)) {
    return {
      error: tx(PLUGINS_TEXTS.qualifiedIdNotFound, {
        glyph: errGlyph,
        id: sanitizeForTerminal(id),
        bundleId: sanitizeForTerminal(bundleId),
        extId: sanitizeForTerminal(extId),
        hint: ansi.dim(PLUGINS_TEXTS.qualifiedIdNotFoundHint),
      }),
    };
  }
  return { key: qualifiedExtensionId(bundleId, extId) };
}

function resolveBareToggle(
  id: string,
  catalogue: IBundleSlim[],
  verb: 'enable' | 'disable',
  ansi: IAnsi,
): IResolvedTarget | { error: string } {
  const errGlyph = ansi.red('✕');
  const bundle = catalogue.find((b) => b.id === id);
  if (!bundle) {
    return {
      error: tx(PLUGINS_TEXTS.pluginNotFound, {
        glyph: errGlyph,
        id: sanitizeForTerminal(id),
        hint: ansi.dim(PLUGINS_TEXTS.pluginNotFoundHint),
      }),
    };
  }
  if (bundle.granularity === 'extension') {
    return {
      error: tx(PLUGINS_TEXTS.granularityExtensionRejectsBundleId, {
        glyph: errGlyph,
        bundleId: sanitizeForTerminal(id),
        verb,
        hint: ansi.dim(PLUGINS_TEXTS.granularityExtensionRejectsBundleIdHint),
      }),
    };
  }
  return { key: bundle.id };
}
