/**
 * Shared action-runtime resolution for the job verbs. Loads the composed
 * extension catalog (built-ins + enabled plugins) once and exposes:
 *
 *   - `loadActionRuntime`, the composed Action catalog plus (a) a map
 *     from each plugin-action's qualified id to its on-disk directory
 *     (where `prompt.md` / `report.schema.json` live) and (b) the
 *     composed Provider catalog (used by `sm job submit` to re-read a
 *     node's body with the same parser pipeline the scan used, for the
 *     submit-time drift verification).
 *   - `resolveAction`, qualified-or-bare-id action lookup.
 *
 * Lives in its own module (extracted from `job-queue.ts`) because THREE
 * consumers share it, `sm job submit` (job-queue.ts), `sm record`
 * (record.ts via record-outcome.ts), and the `sm job run` drain loop
 * (job-run.ts), and record-outcome.ts + job-queue.ts would otherwise
 * import each other in a cycle.
 */

import { dirname } from 'node:path';

import type { IAction, IProvider } from '../../kernel/extensions/index.js';
import type { IDiscoveredPlugin } from '../../kernel/types/plugin.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { composeScanExtensions, loadPluginRuntime } from '../util/plugin-runtime.js';
import type { IPrinter } from '../util/printer.js';

export interface IActionRuntime {
  actions: IAction[];
  /** Composed Providers; `sm job submit` re-reads node bodies through them. */
  providers: IProvider[];
  /** qualified action id -> directory holding `prompt.md` / `report.schema.json`. */
  dirByAction: Map<string, string>;
}

/**
 * Load the composed action catalog (built-ins + enabled plugins) plus a map
 * from each plugin-action's qualified id to its on-disk directory (derived
 * from the loaded extension's `entryPath`, so no path convention is
 * reconstructed). Built-in actions carry no directory; they are all
 * deterministic today and never reach the prompt-template resolution.
 *
 * Shared by `sm job submit` (resolves `prompt.md` + node bodies), `sm
 * record` (resolves `report.schema.json`), and the `sm job run` loop, all
 * of which resolve an action against the same composed runtime.
 */
export async function loadActionRuntime(printer: IPrinter): Promise<IActionRuntime> {
  const runtime = await loadPluginRuntime();
  runtime.emitWarnings(printer);
  const composed = composeScanExtensions({
    noBuiltIns: false,
    pluginRuntime: runtime,
    killSwitches: readConformanceKillSwitches(),
  });
  const dirByAction = buildActionDirMap(runtime.discovered);
  return {
    actions: composed?.actions ?? [],
    providers: composed?.providers ?? [],
    dirByAction,
  };
}

function buildActionDirMap(discovered: IDiscoveredPlugin[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const plugin of discovered) {
    for (const ext of plugin.extensions ?? []) {
      if (ext.kind !== 'action') continue;
      map.set(qualifiedExtensionId(ext.pluginId, ext.id), dirname(ext.entryPath));
    }
  }
  return map;
}

/** Resolve an action by qualified id (`<plugin>/<id>`) or bare id. */
export function resolveAction(actions: readonly IAction[], id: string): IAction | null {
  for (const action of actions) {
    if (qualifiedExtensionId(action.pluginId, action.id) === id) return action;
  }
  for (const action of actions) {
    if (action.id === id) return action;
  }
  return null;
}
