/**
 * Composed extension runtime for the job-submit machinery, the shape the
 * submit engine (`core/jobs/submit-engine.ts`) resolves extensions
 * against. Moved down from `cli/commands/action-runtime.ts` (audit M3)
 * so BOTH drivers share one builder:
 *
 *   - the CLI (`cli/commands/action-runtime.ts: loadActionRuntime`) loads
 *     a fresh plugin runtime per invocation and adapts its `IPrinter` to
 *     the warning sink;
 *   - the BFF calls `buildActionRuntime` directly with its BOOT-CACHED
 *     plugin runtime, never re-walking `.skill-map/plugins/` per request.
 *
 * `buildActionRuntime` composes the Action + Analyzer catalogs plus
 * (a) maps from each plugin extension's qualified id to its on-disk
 * directory (where `prompt.md` / `report.schema.json` live) and
 * (b) the composed Provider catalog (used by the submit path to re-read
 * a node's body with the same parser pipeline the scan used, for the
 * submit-time drift verification). Analyzers ride along because the
 * queue is kind-agnostic (`spec/cli-contract.md` §Jobs): a probabilistic
 * finder Analyzer submits, claims, and records through the same
 * machinery as a probabilistic Action.
 */

import { dirname } from 'node:path';

import type { IAction, IAnalyzer, IHook, IProvider } from '../../kernel/extensions/index.js';
import type { IDiscoveredPlugin } from '../../kernel/types/plugin.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';

import {
  composeScanExtensions,
  type IConformanceKillSwitches,
  type IPluginRuntime,
} from '../runtime/plugin-runtime.js';

export interface IActionRuntime {
  actions: IAction[];
  /** Composed Analyzers (both modes); the queue verbs read the probabilistic subset. */
  analyzers: IAnalyzer[];
  /** Composed Providers; the submit engine re-reads node bodies through them. */
  providers: IProvider[];
  /**
   * Composed (enabled) Hooks. `sm record` dispatches `job.completed` to these
   * so the opt-in `core/auto-fix` hook can chain finder -> fixer
   * (`spec/architecture.md` §Modelo B · Auto-fix). Empty unless a hook is
   * enabled; the record path is a no-op then.
   */
  hooks: IHook[];
  /** qualified action id -> directory holding `prompt.md` / `report.schema.json`. */
  dirByAction: Map<string, string>;
  /** qualified analyzer id -> directory holding `prompt.md` / `report.schema.json`. */
  dirByAnalyzer: Map<string, string>;
}

/**
 * Pluggable warning sink. Receives one already-rendered plugin-runtime
 * warning line (no trailing newline) per call; the CLI adapts it to
 * `printer.warn(line + '\n')`, the BFF to its own advisory channel.
 */
export type TActionRuntimeWarn = (line: string) => void;

/**
 * Build the composed extension catalogs (built-ins + enabled plugins)
 * from an ALREADY-LOADED plugin runtime, plus maps from each plugin
 * extension's qualified id to its on-disk directory (derived from the
 * loaded extension's `entryPath`, so no path convention is
 * reconstructed). Built-in extensions carry no directory; probabilistic
 * built-ins resolve through their codegen-inlined `promptTemplate` /
 * `reportSchema` instead.
 *
 * Pure composition, no discovery pass: the caller owns the plugin
 * runtime's lifetime (fresh per CLI invocation; boot-cached in the BFF,
 * audit M3). `killSwitches` is the conformance-only override the CLI
 * adapter reads from the environment (`cli/util/conformance-env.ts`);
 * production callers may omit it.
 */
export function buildActionRuntime(
  pluginRuntime: IPluginRuntime,
  warn: TActionRuntimeWarn,
  killSwitches?: IConformanceKillSwitches,
): IActionRuntime {
  for (const line of pluginRuntime.warnings) {
    warn(line);
  }
  const composed = composeScanExtensions({
    noBuiltIns: false,
    pluginRuntime,
    ...(killSwitches !== undefined ? { killSwitches } : {}),
  }) ?? { providers: [], extractors: [], analyzers: [], hooks: [], actions: [] };
  return {
    actions: composed.actions,
    analyzers: composed.analyzers,
    providers: composed.providers,
    hooks: composed.hooks,
    dirByAction: buildActionDirMap(pluginRuntime.discovered),
    dirByAnalyzer: buildExtensionDirMap(pluginRuntime.discovered, 'analyzer'),
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
