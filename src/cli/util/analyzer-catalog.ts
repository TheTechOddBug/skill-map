/**
 * CLI-side half of the analyzer-catalog gate: load the live catalog for
 * the verbs that take an analyzer id as input, and render the shared
 * "valid ids" block.
 *
 * Consumers:
 *   - `sm check --analyzers <ids>` (`cli/commands/check.ts`), the read
 *     filter: an unrecognised id would silently narrow the listing to
 *     zero rows and mask the very issue the user was looking for.
 *   - `sm issues dismiss <analyzer> <value>`
 *     (`cli/commands/issues.ts`), the write path: an unrecognised id
 *     would land in the node's COMMITTED `.sm` sidecar as a standing
 *     `annotations.issueSuppressions` entry that can never match
 *     anything, i.e. permanent repo junk born from a typo.
 *
 * Only the LOADING is CLI-level: it needs the `printer` (plugin load
 * warnings go to stderr the way `sm scan` emits them), the verb's
 * `--no-plugins` stance, and the conformance kill-switch env read (the
 * CLI is the layer allowed to touch `process.env`). The projection +
 * validation themselves are printer-free and shared with the BFF route
 * and the MCP tool from `core/runtime/analyzer-catalog.ts`; the pure
 * matcher for a PERSISTED `analyzerId` stays in
 * `kernel/util/analyzer-filter.ts`.
 */

import type { IAnalyzer } from '../../kernel/extensions/index.js';
import { analyzerCatalogFrom } from '../../core/runtime/analyzer-catalog.js';
import {
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../../core/runtime/plugin-runtime.js';
import type { IPrinter } from '../../core/runtime/printer.js';
import { readConformanceKillSwitches } from './conformance-env.js';

export interface ILoadAnalyzerCatalogOptions {
  /** Skip drop-in plugin discovery; only kernel built-ins participate. */
  noPlugins: boolean;
  /** Channel-aware writer; plugin load warnings are forwarded to it. */
  printer: IPrinter;
}

/**
 * Load the plugin runtime + built-ins and return the full Analyzer
 * catalog the orchestrator would dispatch under the current config.
 * Plugin load warnings are forwarded to stderr so the user sees the
 * same diagnostics `sm scan` produces.
 *
 * The result feeds analyzer-id validation: every user-supplied id must
 * appear here.
 */
export async function loadAnalyzerCatalog(
  opts: ILoadAnalyzerCatalogOptions,
): Promise<IAnalyzer[]> {
  const pluginRuntime = opts.noPlugins
    ? emptyPluginRuntime()
    : await loadPluginRuntime();
  pluginRuntime.emitWarnings(opts.printer);
  return analyzerCatalogFrom(pluginRuntime, readConformanceKillSwitches());
}

/**
 * Render the valid-id list for a `{{known}}` slot: one qualified id per
 * line, each prefixed by `indent`. Verbs pass the indent that lines the
 * block up under their own message body.
 */
export function formatKnownAnalyzerIds(
  known: readonly string[],
  indent = '  ',
): string {
  return known.map((id) => `${indent}${id}`).join('\n');
}
