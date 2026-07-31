/**
 * Shared analyzer-catalog projection + operator-supplied analyzer id
 * validation, the guard behind every `issues dismiss` face.
 *
 * Lives in `core/` (the layer both drivers consume) because all THREE
 * faces of the same write need the identical gate:
 *
 *   - `sm issues dismiss <analyzer> <value>` and the sibling read filter
 *     `sm check --analyzers <ids>` (`cli/util/analyzer-catalog.ts`,
 *     which loads a fresh runtime per invocation);
 *   - `POST /api/nodes/:pathB64/issues/dismiss`
 *     (`server/routes/node-issue-actions.ts`);
 *   - the MCP `dismiss_issue` tool (`server/mcp/issues-tools.ts`).
 *
 * The write path is why the gate exists: an unrecognised id lands in the
 * node's COMMITTED `.sm` sidecar as a standing
 * `annotations.issueSuppressions` entry that can never match anything,
 * i.e. permanent repo junk born from a typo. Duplicating the matcher per
 * face is how the three would drift, so the projection + the validation
 * live here once and each face renders its own refusal.
 *
 * Printer-free, discovery-free, side-effect-free on purpose: the caller
 * hands in the `IPluginRuntime` it ALREADY has (the CLI loads one per
 * invocation, the BFF and MCP read the boot-cached holder), so this
 * module never touches stderr, `process.env`, or the filesystem, and
 * `core/` stays importable from `cli/` and `server/` alike.
 *
 * `validateAnalyzerFilter` returns FACTS (the unknown ids, the known
 * ids), not a rendered message: each surface owns its own wording in its
 * own catalog (`sm check` prints a bare block, `sm issues` the glyph +
 * hint shape, the BFF a `bad-query` envelope message, MCP an
 * `McpError`), and `tx` throws on a missing placeholder, so one shared
 * template could not serve them all anyway.
 *
 * The pure matcher that decides whether a PERSISTED `analyzerId`
 * satisfies a filter is the other half of the same grammar and stays in
 * `kernel/util/analyzer-filter.ts`.
 */

import type { IAnalyzer } from '../../kernel/extensions/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import {
  composeScanExtensions,
  type IConformanceKillSwitches,
  type IPluginRuntime,
} from './plugin-runtime.js';

/**
 * The outcome of validating operator-supplied analyzer ids against the
 * live catalog. Only produced when at least one id is unrecognised.
 */
export interface IUnknownAnalyzerIds {
  /** The unrecognised ids, verbatim as typed, in the caller's order. */
  unknown: readonly string[];
  /** Every valid QUALIFIED id (`<plugin>/<analyzer>`), sorted. */
  known: readonly string[];
}

/**
 * Project the full Analyzer catalog the orchestrator would dispatch out
 * of an already-loaded plugin runtime: built-ins plus drop-in plugins,
 * with the runtime's own enabled-resolver applied (the same set
 * `sm scan` would run).
 *
 * `resolveSettings` is intentionally omitted: this compose only
 * ENUMERATES ids for validation, no analyzer is invoked, so its
 * `ctx.settings` never matters and the callers have no merged config in
 * hand at this call site. Per the wiring contract, leave it unset.
 *
 * `killSwitches` is the conformance-only escape hatch; only the CLI
 * passes it (it is the layer allowed to read `process.env`).
 */
export function analyzerCatalogFrom(
  pluginRuntime: IPluginRuntime,
  killSwitches?: IConformanceKillSwitches,
): IAnalyzer[] {
  const composed = composeScanExtensions({
    noBuiltIns: false,
    pluginRuntime,
    ...(killSwitches !== undefined ? { killSwitches } : {}),
  });
  return composed?.analyzers ?? [];
}

/**
 * Validate every operator-supplied analyzer id against the loaded
 * catalog. Accepts qualified (`core/reference-broken`) and bare
 * (`reference-broken`) forms, matching the runtime filter
 * (`matchesAnalyzerFilter`) and the contract clause "qualified
 * preferred, bare short accepted". Returns `null` when every id is
 * recognised, or the unknown / known id sets otherwise.
 *
 * Listing the bare form alongside the qualified form in `known` would
 * double the output without adding information, the matcher accepts the
 * suffix automatically.
 */
export function validateAnalyzerFilter(
  filter: readonly string[],
  analyzers: readonly IAnalyzer[],
): IUnknownAnalyzerIds | null {
  const knownQualified = new Set<string>();
  const knownShort = new Set<string>();
  for (const analyzer of analyzers) {
    knownQualified.add(qualifiedExtensionId(analyzer.pluginId, analyzer.id));
    knownShort.add(analyzer.id);
  }
  const unknown = filter.filter((id) => !knownQualified.has(id) && !knownShort.has(id));
  if (unknown.length === 0) return null;
  return { unknown, known: [...knownQualified].sort() };
}
