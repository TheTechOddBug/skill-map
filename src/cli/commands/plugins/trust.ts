/**
 * `sm plugins trust <id>...` / `sm plugins untrust <id>...`, grant or
 * revoke LOCAL import trust for one or more project-local drop-in
 * plugins (or every discovered plugin via `--all`).
 *
 * Trust is the SECURITY axis, orthogonal to enable: a project-local
 * plugin's code is imported only when it is BOTH enabled (config) AND
 * trusted (this DB store) on this machine. `sm plugins enable / disable`
 * is operational only and never touches trust. The trust grant is
 * per-plugin (a bare plugin id; a qualified `<plugin>/<ext>` collapses to
 * its plugin) and persists a grant in the scope lock
 * (`.skill-map/scope.lock.json`). Being gitignored is NOT what makes it
 * safe, the ignore list is the repo author's to edit; the grant is
 * anchored to this checkout's `.skill-map/` identity, so a cloned repo
 * cannot auto-trust its own plugins.
 *
 * Built-ins and host-locked ids are never import-trust-gated, so a trust
 * verb that targets one is rejected with a directed message. `--all`
 * applies to every DISCOVERED drop-in plugin (built-ins are excluded by
 * construction). Batches are all-or-nothing (an unknown / built-in id
 * aborts before any write) and repeated ids are deduped.
 */

import { Command, Option } from 'clipanion';

import { builtInPlugins } from '../../../plugins/built-ins.js';
import { isLockedBuiltIn } from '../../../plugins/locked-built-ins.js';
import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import type { IAnsi } from '../../util/ansi.js';
import {
  grantTrust,
  loadTrust,
  revokeTrust,
  type TGrantOutcome,
} from '../../../kernel/config/plugin-trust-store.js';
import { confirm } from '../../util/confirm.js';
import { ExitCode } from '../../util/exit-codes.js';
import { defaultRuntimeContext } from '../../../core/runtime/runtime-context.js';
import { SmCommand } from '../../util/sm-command.js';
import { loadAll } from './shared.js';

abstract class TrustPluginsBase extends SmCommand {
  all = Option.Boolean('--all', false);
  yes = Option.Boolean('--yes,-y', false, {
    description: 'Skip the interactive confirm on --all (required in non-TTY callers).',
  });
  ids = Option.Rest({ name: 'ids' });

  protected async applyTrust(trusted: boolean): Promise<number> {
    // No drift guard here any more: the grant is a scope-lock record, not
    // a DB row, so a drifted or rebuilt database cannot lose it. That
    // durability is the point, an operator's vetting decision should not
    // evaporate on a version bump.
    const verb = trusted ? 'trust' : 'untrust';
    const stderrAnsi = this.ansiFor('stderr');

    const argError = this.#validateArgs(stderrAnsi, verb);
    if (argError !== null) return argError;

    const plugins = await loadAll({ pluginDir: undefined });
    // Trust targets project-local drop-in plugins only; built-ins (and
    // host-locked ids) are never trust-gated. The discovered set IS the
    // drop-in set (`builtInPlugins` are compiled in, not discovered).
    const discoveredIds = new Set(plugins.map((p) => p.id));

    const resolved = this.#resolvePluginIds(plugins, discoveredIds, verb, stderrAnsi);
    if (typeof resolved === 'number') return resolved;
    if (resolved.length === 0) {
      // `--all` with no drop-in plugins on disk: nothing to do, exit
      // clean so scripts do not treat an empty project as an error.
      this.printer!.info(tx(PLUGINS_TEXTS.trustNoPlugins, { verb }));
      return ExitCode.Ok;
    }

    // `--all` is the reach for anyone who just wants an advisory to stop,
    // which is exactly the moment a hostile repo's plugin would ride
    // along. Show the ids first, marking the ones whose grant came from
    // another copy, so an unfamiliar name is seen before it is trusted.
    // Explicit ids skip this: the operator already named them.
    const applied = await this.#confirmAndPersist(resolved, trusted, stderrAnsi);
    if (applied === 'aborted') return ExitCode.Ok;
    if (!applied.ok) {
      // The filesystem cannot anchor a grant (`/mnt/c`, `/proc`, exotic
      // mounts report no birth time). Re-running would not help, so the
      // message names the environment rather than telling the operator
      // to try again.
      this.printer!.error(
        tx(PLUGINS_TEXTS.trustAnchorUnusable, {
          glyph: stderrAnsi.red('✕'),
          hint: stderrAnsi.dim(PLUGINS_TEXTS.trustAnchorUnusableHint),
        }),
      );
      return ExitCode.Error;
    }
    this.#renderSuccess(resolved, trusted);
    return ExitCode.Ok;
  }

  /**
   * `--all` vs `<id>...` mutex check (one must be present, not both).
   * Reuses the toggle family's two-line rejection blocks so trust /
   * enable read in parallel.
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
   * Resolve `<id>...` (or `--all`) into the deduped set of BARE plugin
   * ids to write. A qualified `<plugin>/<ext>` collapses to its plugin.
   * The first unresolvable id (built-in / host-locked, or unknown)
   * aborts the whole batch before any write so the operator never lands
   * in a partial state.
   */
  #resolvePluginIds(
    _plugins: IDiscoveredPlugin[],
    discoveredIds: ReadonlySet<string>,
    _verb: string,
    ansi: IAnsi,
  ): string[] | number {
    if (this.all) {
      return [...discoveredIds];
    }
    const out: string[] = [];
    const seen = new Set<string>();
    for (const rawId of this.ids) {
      const bare = collapseToPluginId(rawId);
      if (isBuiltInOrLocked(bare)) {
        this.printer!.error(
          tx(PLUGINS_TEXTS.trustBuiltInRejected, {
            glyph: ansi.red('✕'),
            id: sanitizeForTerminal(bare),
            hint: ansi.dim(PLUGINS_TEXTS.trustBuiltInRejectedHint),
          }),
        );
        return ExitCode.NotFound;
      }
      if (!discoveredIds.has(bare)) {
        this.printer!.error(
          tx(PLUGINS_TEXTS.pluginNotFound, {
            glyph: ansi.red('✕'),
            id: sanitizeForTerminal(bare),
            hint: ansi.dim(PLUGINS_TEXTS.pluginNotFoundHint),
          }),
        );
        return ExitCode.NotFound;
      }
      if (seen.has(bare)) continue;
      seen.add(bare);
      out.push(bare);
    }
    return out;
  }

  /**
   * Gate the write behind the `--all` confirm, then persist. Split out so
   * `applyTrust` stays under the complexity cap.
   */
  async #confirmAndPersist(
    resolved: string[],
    trusted: boolean,
    ansi: IAnsi,
  ): Promise<TGrantOutcome | 'aborted'> {
    if (trusted && this.all && !(await this.#confirmAll(resolved, ansi))) {
      this.printer!.info(tx(PLUGINS_TEXTS.trustAllAborted, { glyph: ansi.cyan('ℹ') }));
      return 'aborted';
    }
    return this.#persist(resolved, trusted);
  }

  /**
   * List what `--all` is about to trust and ask. `--yes` bypasses, and a
   * non-TTY caller without it is refused rather than auto-approved: the
   * whole point is that a human sees the names.
   */
  async #confirmAll(pluginIds: string[], ansi: IAnsi): Promise<boolean> {
    if (this.yes) return true;
    const { trusted: alreadyTrusted, skipped } = loadTrust(defaultRuntimeContext().cwd);
    const foreign = new Set(
      skipped.filter((s) => s.reason === 'foreign-scope').map((s) => s.pluginId),
    );
    const rows = pluginIds
      .filter((id) => !alreadyTrusted.has(id))
      .map((id) =>
        tx(PLUGINS_TEXTS.trustAllRow, {
          id: sanitizeForTerminal(id),
          note: foreign.has(id) ? ansi.dim(PLUGINS_TEXTS.trustAllForeignNote) : '',
        }),
      );
    if (rows.length === 0) return true;
    return confirm(
      tx(PLUGINS_TEXTS.trustAllConfirm, { count: rows.length, rows: rows.join('\n') }),
      { stdin: this.context.stdin, stderr: this.context.stderr },
    );
  }

  /**
   * Write the grant for every resolved bare plugin id into the scope
   * lock. `trusted` true grants import trust, false revokes it (the next
   * scan / restart reverts the plugin to discovered-but-unexecuted).
   * Each id gets its OWN grant: a shared one would be refreshed by any
   * later write and would bless records the operator never approved.
   */
  async #persist(pluginIds: string[], trusted: boolean): Promise<TGrantOutcome> {
    const ctx = defaultRuntimeContext();
    if (!trusted) {
      for (const id of pluginIds) revokeTrust(ctx.cwd, id);
      return { ok: true };
    }
    for (const id of pluginIds) {
      const outcome = grantTrust(ctx.cwd, id);
      // Refuse the whole batch rather than persist records that could
      // never verify: showing "trusted" for something that will silently
      // never load is the worst available failure.
      if (!outcome.ok) return outcome;
    }
    return { ok: true };
  }

  #renderSuccess(pluginIds: string[], trusted: boolean): void {
    const verbPast = trusted ? 'trusted' : 'untrusted';
    if (pluginIds.length === 1) {
      this.printer!.data(tx(PLUGINS_TEXTS.trustAppliedSingle, { verbPast, id: pluginIds[0]! }));
      return;
    }
    this.printer!.data(
      tx(PLUGINS_TEXTS.trustAppliedManyHeader, { verbPast, count: pluginIds.length }),
    );
    for (const id of pluginIds) {
      this.printer!.data(tx(PLUGINS_TEXTS.trustAppliedManyRow, { id }));
    }
  }
}

/** Collapse a qualified `<plugin>/<ext>` id to its bare plugin id. */
function collapseToPluginId(id: string): string {
  const slash = id.indexOf('/');
  return slash < 0 ? id : id.slice(0, slash);
}

/**
 * True when `id` names a built-in plugin or a host-locked id, neither of
 * which is import-trust-gated. Trust verbs reject these.
 */
function isBuiltInOrLocked(id: string): boolean {
  if (isLockedBuiltIn(id)) return true;
  return builtInPlugins.some((p) => p.id === id);
}

export class PluginsTrustCommand extends TrustPluginsBase {
  static override paths = [['plugins', 'trust']];
  static override exitCodes = [ExitCode.Ok, ExitCode.Error, ExitCode.NotFound];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Grant LOCAL import trust to one or more project-local plugins (or --all). Persists in the scope lock, per checkout.',
    details: `
      Records this machine's consent to import and run the plugin's code.
      Trust is the SECURITY axis, distinct from enable: a project-local
      plugin runs only when it is BOTH enabled (config) and trusted (this
      DB store). Per-plugin (bare id); a qualified <plugin>/<ext> collapses
      to its plugin. Local only, never committed, so it cannot travel in a
      clone.

      Accepts one or more ids, or --all (every discovered drop-in plugin).
      Batches are all-or-nothing: a built-in / host-locked / unknown id
      aborts before any write. Repeated ids are deduped. Granting trust
      lets an enabled plugin's code import on the next scan / sm serve
      restart.
    `,
  });

  protected async run(): Promise<number> {
    return this.applyTrust(true);
  }
}

export class PluginsUntrustCommand extends TrustPluginsBase {
  static override paths = [['plugins', 'untrust']];
  static override exitCodes = [ExitCode.Ok, ExitCode.Error, ExitCode.NotFound];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Revoke LOCAL import trust from one or more project-local plugins (or --all). Does not delete files or change enable state.',
    details: `
      Drops the plugin's scope-lock grant, so it reverts to
      discovered-but-unexecuted on the next scan / restart. Does NOT change
      the enable state and does NOT delete the plugin directory. Same
      id / batch semantics as sm plugins trust.
    `,
  });

  protected async run(): Promise<number> {
    return this.applyTrust(false);
  }
}
