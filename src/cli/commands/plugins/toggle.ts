/**
 * `sm plugins enable <id>...` / `sm plugins disable <id>...`, flip
 * the persisted enable-state for one or more extensions (or every
 * extension via `--all`).
 *
 * Writes to `config_plugins`, which takes precedence over the
 * team-shared baseline at `settings.json#/plugins/<id>/enabled`. On
 * disable, also purges persisted `scan_contributions` rows so the UI
 * stops rendering the plugin's footer / card chips before the next
 * scan.
 *
 * **Toggle model**: every extension is independently toggle-able by
 * its qualified id `<bundle>/<ext>`. The bundle itself is a
 * presentational grouping. Two id shapes resolve here:
 *
 *   - **qualified id** (`claude/at-directive`, `core/markdown-link`): the
 *     direct toggle. Always applies to that one extension; no prompt.
 *   - **bare bundle id** (`claude`, `core`): the macro form. Fans the
 *     toggle out across every extension inside the bundle:
 *       * Bundle with exactly one extension (`openai`,
 *         `agent-skills`, `antigravity`): applies the toggle directly
 *         to the single child. No prompt (1-1 mapping).
 *       * Bundle with two or more extensions (`claude`, `core`):
 *         requires `--yes` OR an interactive TTY confirm. Without
 *         `--yes` in a non-TTY context the verb refuses and prints the
 *         list of affected extensions plus the re-run hint.
 *
 * `--all` cascades through every discovered bundle (built-ins + user
 * plugins) and every extension inside. Always requires `--yes` in
 * non-TTY contexts.
 */

import { Command, Option } from 'clipanion';

import { builtInBundles } from '../../../plugins/built-ins.js';
import { isPluginLocked } from '../../../kernel/config/locked-plugins.js';
import { qualifiedExtensionId } from '../../../kernel/registry.js';
import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import { captureUsage } from '../../telemetry/posthog-init.js';
import { buildScanExtensionSet } from '../../telemetry/usage-collector.js';
import type { IAnsi } from '../../util/ansi.js';
import { confirm } from '../../util/confirm.js';
import { resolveDbPath } from '../../util/db-path.js';
import { ExitCode } from '../../util/exit-codes.js';
import { defaultRuntimeContext } from '../../util/runtime-context.js';
import { SmCommand } from '../../util/sm-command.js';
import { withSqlite } from '../../util/with-sqlite.js';
import { loadAll } from './shared.js';

interface IBundleSlim {
  id: string;
  /** Qualified `<bundle>/<ext>` ids of every extension inside. */
  extensionIds: string[];
}

interface IResolvedTarget {
  /** Origin of the resolution, used by the macro-prompt path. */
  origin: 'qualified' | 'bare';
  /** Bare bundle id when `origin === 'bare'`, parsed from the user input. */
  bundleId?: string;
  /**
   * Qualified extension ids to flip. `qualifiedExtensionId(...)` shape
   * (`<bundle>/<ext>`). For `origin === 'bare'` carries every child
   * extension of the bundle; for `origin === 'qualified'` carries
   * exactly one entry.
   */
  keys: string[];
}

abstract class TogglePluginsBase extends SmCommand {
  all = Option.Boolean('--all', false);
  yes = Option.Boolean('--yes,-y', false, {
    description:
      'Skip the interactive confirm when a bare bundle id (or --all) fans the toggle out across multiple extensions.',
  });
  ids = Option.Rest({ name: 'ids' });

  protected async toggle(enabled: boolean): Promise<number> {
    const verb = enabled ? 'enable' : 'disable';
    const stderrAnsi = this.ansiFor('stderr');

    const argError = this.#validateArgs(stderrAnsi, verb);
    if (argError !== null) return argError;

    const plugins = await loadAll({ pluginDir: undefined });
    const catalogue = bundleCatalogue(plugins);

    const targetsResult = this.#pickTargets(catalogue, stderrAnsi);
    if (typeof targetsResult === 'number') return targetsResult;
    let targets = targetsResult;

    // Macro-prompt gate: a `--all` request or a bare bundle id whose
    // bundle holds more than one extension requires confirmation. A
    // bare bundle id mapped to a single child extension applies
    // straight through (1-1 mapping; the user typed the natural name).
    const macroOk = await this.#confirmMacroIfNeeded(targets, verb, stderrAnsi);
    if (!macroOk) return ExitCode.Error;

    const lockError = this.#applyLockGate(targets, stderrAnsi);
    if (typeof lockError === 'number') return lockError;
    targets = lockError;

    const keys = expandToKeys(targets);
    await this.#persistKeys(keys, enabled);
    // Usage analytics (opt-in, default OFF; no-op unless active): record which
    // plugins were enabled / disabled. Built-in qualified ids pass through,
    // third-party collapse to `external_plugin`. See spec/telemetry.md.
    const set = buildScanExtensionSet(keys);
    captureUsage('plugin.apply', enabled ? { enabled: set, disabled: [] } : { enabled: [], disabled: set });
    this.#renderSuccess(keys, enabled);
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
   * directed-error path (unknown id, malformed qualified id).
   *
   * Repeated ids in the same call are deduped at the target level
   * (`origin === 'bare'` and `origin === 'qualified'` rows stay
   * distinct so the macro-confirm path can address each correctly).
   * The first unknown id aborts the batch before any DB write so the
   * user never lands in a partial state.
   */
  #pickTargets(catalogue: IBundleSlim[], ansi: IAnsi): IResolvedTarget[] | number {
    if (this.all) {
      return catalogue.map((b) => ({
        origin: 'bare' as const,
        bundleId: b.id,
        keys: b.extensionIds.map((extId) => qualifiedExtensionId(b.id, extId)),
      }));
    }
    const out: IResolvedTarget[] = [];
    const seen = new Set<string>();
    for (const rawId of this.ids) {
      const resolved = resolveToggleTarget(rawId, catalogue, ansi);
      if ('error' in resolved) {
        this.printer!.error(tx(PLUGINS_TEXTS.toggleResolveError, { error: resolved.error }));
        // Unknown / malformed id: same exit code (5, NotFound) the
        // pre-macro shape used for "you asked me to act on something
        // I cannot resolve".
        return ExitCode.NotFound;
      }
      // Dedup keys across separate targets so persisting them later
      // is idempotent without losing the per-target origin metadata.
      const novelKeys = resolved.keys.filter((k) => !seen.has(k));
      if (novelKeys.length === 0) continue;
      for (const k of novelKeys) seen.add(k);
      out.push({ ...resolved, keys: novelKeys });
    }
    return out;
  }

  /**
   * Macro gate: when the request would fan a single user input out
   * across more than one extension (either `--all` or a bare bundle
   * id whose bundle holds ≥2 extensions), confirm the intent.
   *
   * Resolution order:
   *   1. `--yes` flag: skip the prompt entirely.
   *   2. TTY stdin: render the list + ask interactively (`[y/N]`).
   *   3. Non-TTY (CI / pipe / agent harness): refuse with a directed
   *      message that names the extensions and points at `--yes`.
   *
   * Returns `true` when the verb should proceed, `false` when it
   * should abort. Single-extension targets (bare bundle id mapping to
   * one child, or qualified ids) skip the gate uniformly.
   */
  // Cyclomatic count comes from the three-stage gate (--yes shortcut,
  // TTY interactive path, non-TTY rejection) folded over the targets
  // loop. Splitting them scatters the contract without making the
  // algorithm clearer.
  // eslint-disable-next-line complexity
  async #confirmMacroIfNeeded(
    targets: IResolvedTarget[],
    verb: string,
    ansi: IAnsi,
  ): Promise<boolean> {
    const macroTargets = targets.filter((t) => requiresMacroConfirm(t));
    if (macroTargets.length === 0) return true;
    if (this.yes) return true;

    const isTty = Boolean(this.context.stdin && 'isTTY' in this.context.stdin && (this.context.stdin as { isTTY?: boolean }).isTTY);

    // Render the per-bundle expansion so the user sees exactly what
    // will flip. Same shape for both branches; the TTY path appends
    // the prompt while the non-TTY path appends the re-run hint.
    for (const target of macroTargets) {
      const bundleLabel = target.origin === 'bare' ? target.bundleId ?? '--all' : '--all';
      this.printer!.info(
        tx(PLUGINS_TEXTS.bundleMacroHeader, {
          verb,
          bundleId: sanitizeForTerminal(bundleLabel),
          count: target.keys.length,
        }),
      );
      for (const key of target.keys) {
        this.printer!.info(tx(PLUGINS_TEXTS.bundleMacroRow, { id: sanitizeForTerminal(key) }));
      }
    }

    if (!isTty) {
      this.printer!.error(
        tx(PLUGINS_TEXTS.bundleMacroRequiresYes, {
          glyph: ansi.red('✕'),
          verb,
          hint: ansi.dim(PLUGINS_TEXTS.bundleMacroRequiresYesHint),
        }),
      );
      return false;
    }

    const ok = await confirm(
      tx(PLUGINS_TEXTS.bundleMacroConfirmPrompt, { verb }),
      { stdin: this.context.stdin, stderr: this.context.stderr },
    );
    if (!ok) {
      this.printer!.info(PLUGINS_TEXTS.bundleMacroCancelled);
    }
    return ok;
  }

  /**
   * Host lock, see `src/kernel/config/locked-plugins.ts`. Bulk modes
   * (`--all`, an explicit batch of >1 targets, or a macro expansion
   * with >1 keys) silently skip locked extensions so the user can
   * still toggle the rest. Single-extension mode surfaces a directed
   * exit-5 message so the user knows their one intended target was
   * refused.
   */
  #applyLockGate(targets: IResolvedTarget[], ansi: IAnsi): IResolvedTarget[] | number {
    const totalKeys = targets.reduce((acc, t) => acc + t.keys.length, 0);
    const bulk = this.all || this.ids.length > 1 || totalKeys > 1;
    if (bulk) {
      return targets.map((t) => ({ ...t, keys: t.keys.filter((k) => !isPluginLocked(k)) }));
    }
    // Single-key path: targets has length 1 and keys has length 1.
    const onlyKey = targets[0]?.keys[0];
    if (!onlyKey || !isPluginLocked(onlyKey)) return targets;
    this.printer!.error(
      tx(PLUGINS_TEXTS.pluginLocked, {
        glyph: ansi.red('✕'),
        id: sanitizeForTerminal(onlyKey),
        hint: ansi.dim(PLUGINS_TEXTS.pluginLockedHint),
      }),
    );
    return ExitCode.NotFound;
  }

  /**
   * Persist every qualified id in `config_plugins`. On disable, also
   * purge the plugin's `scan_contributions` rows immediately (matches
   * the BFF route, see `server/routes/plugins.ts:applyChangeToAdapter`).
   * Every key is `<bundle>/<ext>` shape so the contribution purge can
   * split into `(pluginId, extensionId)` cleanly.
   */
  async #persistKeys(keys: string[], enabled: boolean): Promise<void> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: undefined, cwd: ctx.cwd });
    await withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      for (const id of keys) {
        await adapter.pluginConfig.set(id, enabled);
        if (!enabled) await purgeContributionsFor(adapter, id);
      }
    });
  }

  #renderSuccess(keys: string[], enabled: boolean): void {
    const verbPast = enabled ? 'enabled' : 'disabled';
    if (keys.length === 1) {
      this.printer!.data(tx(PLUGINS_TEXTS.toggleAppliedSingle, { verbPast, id: keys[0]! }));
    } else {
      this.printer!.data(
        tx(PLUGINS_TEXTS.toggleAppliedManyHeader, { verbPast, count: keys.length }),
      );
      for (const id of keys) {
        this.printer!.data(tx(PLUGINS_TEXTS.toggleAppliedManyRow, { id }));
      }
    }
  }
}

/**
 * A target needs the macro confirm prompt when it expands across more
 * than one extension. The macro shape is either `--all` (cascade
 * across every bundle) or a bare bundle id whose bundle holds ≥2
 * children. Single-child bundles (`openai`, `antigravity`,
 * `agent-skills`) and qualified ids skip the prompt entirely.
 */
function requiresMacroConfirm(target: IResolvedTarget): boolean {
  if (target.origin !== 'bare') return false;
  return target.keys.length >= 2;
}

/** Flatten resolved targets to the deduped list of qualified ids. */
function expandToKeys(targets: IResolvedTarget[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    for (const k of t.keys) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
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
    description: 'Enable one or more extensions (or --all). Persists in config_plugins.',
    details: `
      Writes a row to config_plugins with enabled=1 per qualified
      extension id. Takes precedence over the team-shared baseline at
      settings.json#/plugins/<id>/enabled. Use sm plugins disable to
      flip; sm config reset plugins.<id>.enabled drops the settings.json
      baseline.

      Accepts qualified ids (\`claude/at-directive\`) and bare bundle
      ids (\`claude\`, which fans the toggle out across every extension
      inside the bundle). Multi-extension bundles need --yes (or an
      interactive TTY confirm) to avoid flipping 27 core extensions by
      accident. Single-extension bundles (openai, agent-skills,
      antigravity) apply without prompting.

      Batches are all-or-nothing: a single unknown id aborts before
      any write. Repeated ids are deduped. Locked extensions inside a
      batch are silently skipped.
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
    description: 'Disable one or more extensions (or --all). Persists in config_plugins; does not delete files.',
    details: `
      Writes a row to config_plugins with enabled=0 per qualified
      extension id. Discovery still surfaces the plugin in
      sm plugins list, but with status=disabled; the kernel will not
      run any of its disabled extensions.

      Accepts qualified ids (\`core/markdown-link\`) and bare bundle
      ids (\`core\`, which fans the toggle out across every extension
      inside the bundle). Multi-extension bundles need --yes (or an
      interactive TTY confirm) to avoid flipping 27 core extensions by
      accident. Single-extension bundles (openai, agent-skills,
      antigravity) apply without prompting.

      Batches are all-or-nothing: a single unknown id aborts before
      any write. Repeated ids are deduped. Locked extensions inside a
      batch are silently skipped.
    `,
  });

  protected async run(): Promise<number> {
    return this.toggle(false);
  }
}

/**
 * Build the canonical bundle catalogue: built-ins first, then any
 * loaded user plugins. Used by `resolveToggleTarget` to expand a bare
 * bundle id into its qualified-extension child set.
 *
 * Plugins whose manifest never validated (`invalid-manifest` /
 * `load-error` without a manifest) are listed with an empty
 * `extensionIds` so the user can disable a buggy plugin by id; the
 * macro path then has zero children to flip and the verb reports the
 * lock state without writing anything.
 */
function bundleCatalogue(plugins: IDiscoveredPlugin[]): IBundleSlim[] {
  const out: IBundleSlim[] = [];
  for (const bundle of builtInBundles) {
    out.push({
      id: bundle.id,
      extensionIds: bundle.extensions.map((e) => e.id),
    });
  }
  for (const p of plugins) {
    out.push({
      id: p.id,
      extensionIds: p.extensions?.map((e) => e.id) ?? [],
    });
  }
  return out;
}

/**
 * Resolve a user-supplied `<id>` against the catalogue. Returns either
 * a `IResolvedTarget` describing what to flip, or a directed error
 * message that explains why the id was rejected (unknown bundle,
 * unknown extension under a known bundle, malformed qualified id).
 *
 * Split internally into two paths (qualified vs bare) so each branch
 * is small enough to stay under the lint cap without an
 * `eslint-disable`.
 */
function resolveToggleTarget(
  id: string,
  catalogue: IBundleSlim[],
  ansi: IAnsi,
): IResolvedTarget | { error: string } {
  return id.includes('/')
    ? resolveQualifiedToggle(id, catalogue, ansi)
    : resolveBareToggle(id, catalogue);
}

function resolveQualifiedToggle(
  id: string,
  catalogue: IBundleSlim[],
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
  return {
    origin: 'qualified',
    keys: [qualifiedExtensionId(bundleId, extId)],
  };
}

function resolveBareToggle(
  id: string,
  catalogue: IBundleSlim[],
): IResolvedTarget | { error: string } {
  const bundle = catalogue.find((b) => b.id === id);
  if (!bundle) {
    return {
      error: tx(PLUGINS_TEXTS.pluginNotFound, {
        glyph: '✕',
        id: sanitizeForTerminal(id),
        hint: PLUGINS_TEXTS.pluginNotFoundHint,
      }),
    };
  }
  return {
    origin: 'bare',
    bundleId: bundle.id,
    keys: bundle.extensionIds.map((extId) => qualifiedExtensionId(bundle.id, extId)),
  };
}
