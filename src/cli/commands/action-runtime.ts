/**
 * Shared extension-runtime resolution for the job verbs. Loads the
 * composed extension catalog (built-ins + enabled plugins) once and
 * exposes:
 *
 *   - `loadActionRuntime`, the composed Action + Analyzer catalogs plus
 *     (a) maps from each plugin extension's qualified id to its on-disk
 *     directory (where `prompt.md` / `report.schema.json` live) and
 *     (b) the composed Provider catalog (used by `sm job submit` to
 *     re-read a node's body with the same parser pipeline the scan used,
 *     for the submit-time drift verification). Analyzers ride along
 *     because the queue is kind-agnostic (`spec/cli-contract.md` §Jobs):
 *     a probabilistic finder Analyzer submits, claims, and records
 *     through the same verbs as a probabilistic Action.
 *   - `resolveAction`, qualified-or-bare-id action lookup.
 *
 * Lives in its own module (extracted from `job-queue.ts`) because TWO
 * consumers share it, `sm job submit` (job-queue.ts) and `sm record`
 * (record.ts via record-outcome.ts), and record-outcome.ts +
 * job-queue.ts would otherwise import each other in a cycle.
 */

import { dirname } from 'node:path';

import type { IAction, IAnalyzer, IProvider } from '../../kernel/extensions/index.js';
import type { IDiscoveredPlugin } from '../../kernel/types/plugin.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { composeScanExtensions, loadPluginRuntime } from '../util/plugin-runtime.js';
import type { IPrinter } from '../util/printer.js';

export interface IActionRuntime {
  actions: IAction[];
  /** Composed Analyzers (both modes); the queue verbs read the probabilistic subset. */
  analyzers: IAnalyzer[];
  /** Composed Providers; `sm job submit` re-reads node bodies through them. */
  providers: IProvider[];
  /** qualified action id -> directory holding `prompt.md` / `report.schema.json`. */
  dirByAction: Map<string, string>;
  /** qualified analyzer id -> directory holding `prompt.md` / `report.schema.json`. */
  dirByAnalyzer: Map<string, string>;
}

/**
 * Load the composed extension catalogs (built-ins + enabled plugins) plus
 * maps from each plugin extension's qualified id to its on-disk directory
 * (derived from the loaded extension's `entryPath`, so no path convention
 * is reconstructed). Built-in extensions carry no directory; probabilistic
 * built-ins resolve through their codegen-inlined `promptTemplate` /
 * `reportSchema` instead.
 *
 * Shared by `sm job submit` (resolves `prompt.md` + node bodies) and
 * `sm record` (resolves `report.schema.json`), both of which resolve an
 * extension against the same composed runtime.
 */
export async function loadActionRuntime(printer: IPrinter): Promise<IActionRuntime> {
  const runtime = await loadPluginRuntime();
  runtime.emitWarnings(printer);
  const composed = composeScanExtensions({
    noBuiltIns: false,
    pluginRuntime: runtime,
    killSwitches: readConformanceKillSwitches(),
  });
  return {
    actions: composed?.actions ?? [],
    analyzers: composed?.analyzers ?? [],
    providers: composed?.providers ?? [],
    dirByAction: buildActionDirMap(runtime.discovered),
    dirByAnalyzer: buildExtensionDirMap(runtime.discovered, 'analyzer'),
  };
}

/**
 * Map each plugin extension of `kind` to its on-disk directory (derived
 * from the loaded extension's `entryPath`), keyed by qualified id.
 */
export function buildExtensionDirMap(
  discovered: IDiscoveredPlugin[],
  kind: 'action' | 'analyzer',
): Map<string, string> {
  const map = new Map<string, string>();
  for (const plugin of discovered) {
    for (const ext of plugin.extensions ?? []) {
      if (ext.kind !== kind) continue;
      map.set(qualifiedExtensionId(ext.pluginId, ext.id), dirname(ext.entryPath));
    }
  }
  return map;
}

/**
 * Action-only projection of `buildExtensionDirMap`. Exported so
 * `sm refresh` can resolve on-disk `report.schema.json` files for the
 * enricher detection against the plugin runtime it already loaded,
 * without a second discovery pass through `loadActionRuntime`.
 */
export function buildActionDirMap(discovered: IDiscoveredPlugin[]): Map<string, string> {
  return buildExtensionDirMap(discovered, 'action');
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
