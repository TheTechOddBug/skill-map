/**
 * `sm plugins enable <id>...` / `sm plugins disable <id>...`, flip
 * the persisted OPERATIONAL enable-state for one or more extensions (or
 * every extension via `--all`).
 *
 * Persists the per-extension `enabled` toggle in the config layers
 * (`plugins.<plugin>.extensions.<ext>.enabled`), defaulting to the
 * team-shared `settings.json`; `--local` writes the gitignored
 * `settings.local.json` instead. This is the OPERATIONAL axis only, it
 * does NOT grant import trust for a project-local plugin (use
 * `sm plugins trust`). On disable, also purges persisted
 * `scan_contributions` rows so the UI stops rendering the plugin's
 * footer / card chips before the next scan.
 *
 * **Toggle model**: every extension is independently toggle-able by
 * its qualified id `<plugin>/<ext>`. The plugin itself is a
 * presentational grouping. Two id shapes resolve here:
 *
 *   - **qualified id** (`claude/at-directive`, `core/markdown-link`): the
 *     direct toggle. Always applies to that one extension; no prompt.
 *   - **bare plugin id** (`claude`, `core`): the macro form. Fans the
 *     toggle out across every extension inside the plugin:
 *       * Plugin with exactly one extension (`codex`,
 *         `agent-skills`, `antigravity`): applies the toggle directly
 *         to the single child. No prompt (1-1 mapping).
 *       * Plugin with two or more extensions (`claude`, `core`):
 *         requires `--yes` OR an interactive TTY confirm. Without
 *         `--yes` in a non-TTY context the verb refuses and prints the
 *         list of affected extensions plus the re-run hint.
 *
 * `--all` cascades through every discovered plugin (built-ins + user
 * plugins) and every extension inside. Always requires `--yes` in
 * non-TTY contexts.
 */

import { Command, Option } from 'clipanion';

import { writeConfigValue } from '../../../core/config/helper.js';
import { cancelQueuedJobsForKeys } from '../../../core/jobs/cancel-disabled.js';
import { appendOperation } from '../../../core/operations-log.js';
import { isLockedBuiltIn } from '../../../plugins/locked-built-ins.js';
import { generateRunId } from '../../../kernel/jobs/index.js';
import { pushJobEvent } from '../../util/job-event-push.js';
import { qualifiedExtensionId } from '../../../kernel/registry.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import { captureUsage } from '../../telemetry/posthog-init.js';
import { buildScanExtensionSet } from '../../telemetry/usage-collector.js';
import type { IAnsi } from '../../util/ansi.js';
import { confirm } from '../../util/confirm.js';
import { resolveDbPath } from '../../util/db-path.js';
import { assertNoDriftForWrite } from '../../../core/sqlite/db-version-runner.js';
import { ExitCode } from '../../util/exit-codes.js';
import { defaultRuntimeContext } from '../../../core/runtime/runtime-context.js';
import { SmCommand } from '../../util/sm-command.js';
import { withSqlite } from '../../../core/sqlite/with-sqlite.js';
import {
  buildResolver,
  loadAll,
  pluginCatalogue,
  parseQualifiedExtensionId,
  renderQualifiedIdError,
  type IPluginCatalogueEntry,
} from './shared.js';
import {
  buildPairEnabledProbe,
  collectPairEdges,
  expandPairToggle,
  pairEdgeSourcesFromBuiltIns,
  pairEdgeSourcesFromDiscovered,
  toEnableConfigKey,
} from '../../../core/plugins/pair-toggle.js';
import { builtInPlugins } from '../../../plugins/built-ins.js';
import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';

interface IResolvedTarget {
  /** Origin of the resolution, used by the macro-prompt path. */
  origin: 'qualified' | 'bare';
  /** Bare plugin id when `origin === 'bare'`, parsed from the user input. */
  pluginId?: string;
  /**
   * Qualified extension ids to flip. `qualifiedExtensionId(...)` shape
   * (`<plugin>/<ext>`). For `origin === 'bare'` carries every child
   * extension of the plugin; for `origin === 'qualified'` carries
   * exactly one entry.
   */
  keys: string[];
}

abstract class TogglePluginsBase extends SmCommand {
  all = Option.Boolean('--all', false);
  yes = Option.Boolean('--yes,-y', false, {
    description:
      'Skip the interactive confirm when a bare plugin id (or --all) fans the toggle out across multiple extensions.',
  });
  local = Option.Boolean('--local', false, {
    description:
      'Write the enable toggle to the gitignored settings.local.json (per-checkout) instead of the team-shared settings.json.',
  });
  ids = Option.Rest({ name: 'ids' });

  protected async toggle(enabled: boolean): Promise<number> {
    // Write verb: `disable` purges `scan_contributions` rows and the
    // pair must behave atomically and symmetrically, so BOTH toggles
    // refuse a drifted DB up front (spec/cli-contract.md §Schema-drift
    // rebuild); a half-applied toggle (settings written, purge refused)
    // would leave inconsistent state. No-ops when the DB does not exist
    // yet (fresh project: both drift axes read `no-meta`).
    const toggleCtx = defaultRuntimeContext();
    assertNoDriftForWrite(resolveDbPath({ db: undefined, cwd: toggleCtx.cwd }));

    const verb = enabled ? 'enable' : 'disable';
    const stderrAnsi = this.ansiFor('stderr');

    const argError = this.#validateArgs(stderrAnsi, verb);
    if (argError !== null) return argError;

    const plugins = await loadAll({ pluginDir: undefined });
    const catalogue = pluginCatalogue(plugins);

    const targetsResult = this.#pickTargets(catalogue, stderrAnsi);
    if (typeof targetsResult === 'number') return targetsResult;
    let targets = targetsResult;

    // Macro-prompt gate: a `--all` request or a bare plugin id whose
    // plugin holds more than one extension requires confirmation. A
    // bare plugin id mapped to a single child extension applies
    // straight through (1-1 mapping; the user typed the natural name).
    const macroOk = await this.#confirmMacroIfNeeded(targets, verb, stderrAnsi);
    if (!macroOk) return ExitCode.Error;

    const lockError = this.#applyLockGate(targets, stderrAnsi);
    if (typeof lockError === 'number') return lockError;
    targets = lockError;

    // Pair toggle (spec/plugin-author-guide.md §Paired extensions):
    // expand the requested keys over the Modelo B edges AFTER the macro
    // confirm (companions never re-prompt) and re-apply the lock filter
    // to the additions (silently, bulk posture: a companion is never
    // the user's single intended target).
    const keys = await this.#expandPairs(expandToKeys(targets), enabled, plugins);
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
  #pickTargets(catalogue: IPluginCatalogueEntry[], ansi: IAnsi): IResolvedTarget[] | number {
    if (this.all) {
      return catalogue.map((b) => ({
        origin: 'bare' as const,
        pluginId: b.id,
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
   * across more than one extension (either `--all` or a bare plugin
   * id whose plugin holds ≥2 extensions), confirm the intent.
   *
   * Resolution order:
   *   1. `--yes` flag: skip the prompt entirely.
   *   2. TTY stdin: render the list + ask interactively (`[y/N]`).
   *   3. Non-TTY (CI / pipe / agent harness): refuse with a directed
   *      message that names the extensions and points at `--yes`.
   *
   * Returns `true` when the verb should proceed, `false` when it
   * should abort. Single-extension targets (bare plugin id mapping to
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

    // Render the per-plugin expansion so the user sees exactly what
    // will flip. Same shape for both branches; the TTY path appends
    // the prompt while the non-TTY path appends the re-run hint.
    for (const target of macroTargets) {
      const pluginLabel = target.origin === 'bare' ? target.pluginId ?? '--all' : '--all';
      this.printer!.info(
        tx(PLUGINS_TEXTS.bundleMacroHeader, {
          verb,
          pluginId: sanitizeForTerminal(pluginLabel),
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
   * Host lock, manifest-declared `locked: true` (see
   * `src/plugins/locked-built-ins.ts`). Bulk modes
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
      return targets.map((t) => ({ ...t, keys: t.keys.filter((k) => !isLockedBuiltIn(k)) }));
    }
    // Single-key path: targets has length 1 and keys has length 1.
    const onlyKey = targets[0]?.keys[0];
    if (!onlyKey || !isLockedBuiltIn(onlyKey)) return targets;
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
   * Pair toggle (spec/plugin-author-guide.md §Paired extensions): expand
   * the requested keys over the Modelo B `analyzerIds` edges. Enable is
   * symmetric and eager; disable is reference-counted (a companion
   * survives while another still-enabled extension keeps its edge
   * alive). Locked companions are dropped silently (bulk lock posture;
   * a companion is never the user's single intended target). Kept
   * companions are reported as informational lines, never a prompt (the
   * macro confirm already ran).
   */
  async #expandPairs(
    requestedKeys: string[],
    enabled: boolean,
    discovered: IDiscoveredPlugin[],
  ): Promise<string[]> {
    const sources = [
      ...pairEdgeSourcesFromBuiltIns(builtInPlugins),
      ...pairEdgeSourcesFromDiscovered(discovered),
    ];
    const { added } = expandPairToggle({
      requestedKeys,
      enabled,
      edges: collectPairEdges(sources),
      isCurrentlyEnabled: buildPairEnabledProbe(sources, await buildResolver()),
    });
    const kept = added.filter((a) => !isLockedBuiltIn(a.key));
    if (kept.length === 0) return requestedKeys;
    this.printer!.info(
      tx(PLUGINS_TEXTS.pairToggleHeader, {
        count: String(kept.length),
        verbPast: enabled ? 'enabled' : 'disabled',
      }),
    );
    for (const a of kept) {
      this.printer!.info(
        tx(PLUGINS_TEXTS.pairToggleRow, {
          id: sanitizeForTerminal(a.key),
          via: sanitizeForTerminal(a.via),
        }),
      );
    }
    return [...requestedKeys, ...kept.map((a) => a.key)];
  }

  /**
   * Persist the per-extension `enabled` toggle for every qualified id in
   * the config layers (`plugins.<plugin>.extensions.<ext>.enabled`),
   * targeting `settings.json` by default or `settings.local.json` with
   * `--local`. On disable, also purge the plugin's `scan_contributions`
   * rows immediately AND cancel each key's `queued` jobs (the disable
   * cascade, `spec/job-lifecycle.md` §Cancellation; matches the BFF
   * route). Every key is `<plugin>/<ext>` shape so both the config
   * dot-path and the contribution purge split into
   * `(pluginId, extensionId)` cleanly.
   */
  async #persistKeys(keys: string[], enabled: boolean): Promise<void> {
    const ctx = defaultRuntimeContext();
    const target: 'project' | 'project-local' = this.local ? 'project-local' : 'project';
    for (const id of keys) {
      writeConfigValue(toEnableConfigKey(id), enabled, { target, cwd: ctx.cwd });
    }
    // On disable, purge persisted contributions so the UI stops
    // rendering the plugin's chips before the next scan, and cancel the
    // keys' queued jobs. Open the DB only for that (enable no longer
    // writes to the DB).
    if (enabled) return;
    const dbPath = resolveDbPath({ db: undefined, cwd: ctx.cwd });
    const cancelledIds = await withSqlite(
      { databasePath: dbPath, autoBackup: false },
      async (adapter) => {
        for (const id of keys) await purgeContributionsFor(adapter, id);
        return cancelQueuedJobsForKeys(adapter, keys, Date.now());
      },
    );
    if (cancelledIds.length === 0) return;
    // Live-transition push per cancelled job (spec/job-events.md
    // §job.cancelled): one queue-mode runId spans the cascade. After the
    // transitions committed; cannot throw. One aggregated ops-log line
    // (mirror of `sm jobs cancel --all`).
    const runId = generateRunId('queue');
    for (const id of cancelledIds) {
      await pushJobEvent(ctx.cwd, {
        type: 'job.cancelled',
        timestamp: Date.now(),
        runId,
        jobId: id,
        data: {},
      });
    }
    appendOperation(ctx.cwd, {
      op: 'jobs.cancel',
      target: '*',
      channel: 'cli',
      outcome: 'cancelled',
      detail: `extension-disabled cancelled=${cancelledIds.length}`,
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
 * across every plugin) or a bare plugin id whose plugin holds ≥2
 * children. Single-child plugins (`codex`, `antigravity`,
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
    description: 'Enable one or more extensions (or --all). Persists the per-extension enabled in the config layers.',
    details: `
      Writes plugins.<plugin>.extensions.<ext>.enabled=true per qualified
      extension id to the team-shared settings.json (or settings.local.json
      with --local). This is the OPERATIONAL axis only; it does NOT grant
      import trust for a project-local plugin (use sm plugins trust).
      Use sm plugins disable to flip; sm config reset
      plugins.<plugin>.extensions.<ext>.enabled drops the override.

      Accepts qualified ids (\`claude/at-directive\`) and bare plugin
      ids (\`claude\`, which fans the toggle out across every extension
      inside the plugin). Multi-extension plugins need --yes (or an
      interactive TTY confirm) to avoid flipping 27 core extensions by
      accident. Single-extension plugins (codex, agent-skills,
      antigravity) apply without prompting.

      Batches are all-or-nothing: a single unknown id aborts before
      any write. Repeated ids are deduped. Locked extensions inside a
      batch are silently skipped.

      Pair toggle: enabling a fixer action also enables the analyzer(s)
      it references via precondition.analyzerIds, and enabling an
      analyzer also enables the fixers referencing it. Companions are
      reported as informational lines and follow the same --local target.
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
    description: 'Disable one or more extensions (or --all). Persists the per-extension enabled in the config layers; does not delete files.',
    details: `
      Writes plugins.<plugin>.extensions.<ext>.enabled=false per qualified
      extension id to the team-shared settings.json (or settings.local.json
      with --local). Discovery still surfaces the plugin in
      sm plugins list, but with status=disabled; the kernel will not
      run any of its disabled extensions.

      Accepts qualified ids (\`core/markdown-link\`) and bare plugin
      ids (\`core\`, which fans the toggle out across every extension
      inside the plugin). Multi-extension plugins need --yes (or an
      interactive TTY confirm) to avoid flipping 27 core extensions by
      accident. Single-extension plugins (codex, agent-skills,
      antigravity) apply without prompting.

      Batches are all-or-nothing: a single unknown id aborts before
      any write. Repeated ids are deduped. Locked extensions inside a
      batch are silently skipped.

      Pair toggle (reference-counted): disabling an analyzer also
      disables each fixer referencing it via precondition.analyzerIds,
      unless another still-enabled analyzer keeps that fixer alive; and
      symmetrically when disabling a fixer. Companion disables run the
      full disable side effects (contribution purge, queued-job
      cancellation).
    `,
  });

  protected async run(): Promise<number> {
    return this.toggle(false);
  }
}

/**
 * Resolve a user-supplied `<id>` against the catalogue. Returns either
 * a `IResolvedTarget` describing what to flip, or a directed error
 * message that explains why the id was rejected (unknown plugin,
 * unknown extension under a known plugin, malformed qualified id).
 *
 * Split internally into two paths (qualified vs bare) so each branch
 * is small enough to stay under the lint cap without an
 * `eslint-disable`.
 */
function resolveToggleTarget(
  id: string,
  catalogue: IPluginCatalogueEntry[],
  ansi: IAnsi,
): IResolvedTarget | { error: string } {
  return id.includes('/')
    ? resolveQualifiedToggle(id, catalogue, ansi)
    : resolveBareToggle(id, catalogue);
}

function resolveQualifiedToggle(
  id: string,
  catalogue: IPluginCatalogueEntry[],
  ansi: IAnsi,
): IResolvedTarget | { error: string } {
  const parsed = parseQualifiedExtensionId(id, catalogue);
  if (!parsed.ok) return { error: renderQualifiedIdError(parsed, id, ansi) };
  return {
    origin: 'qualified',
    keys: [qualifiedExtensionId(parsed.pluginId, parsed.extId)],
  };
}

function resolveBareToggle(
  id: string,
  catalogue: IPluginCatalogueEntry[],
): IResolvedTarget | { error: string } {
  const plugin = catalogue.find((b) => b.id === id);
  if (!plugin) {
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
    pluginId: plugin.id,
    keys: plugin.extensionIds.map((extId) => qualifiedExtensionId(plugin.id, extId)),
  };
}
