/**
 * Pair toggle, the enable-axis half of Modelo B
 * (`spec/plugin-author-guide.md` §Paired extensions (pair toggle)).
 *
 * A fixer Action and the analyzer(s) named in its
 * `precondition.analyzerIds` form a pair, and the toggle surface keeps
 * pairs coherent so a pair never ends up half-armed:
 *
 *   - **Enable is symmetric and eager**: enabling either side of an
 *     edge also enables the other side.
 *   - **Disable is reference-counted over the edges**: disabling an
 *     analyzer pulls each fixer referencing it UNLESS that fixer still
 *     references another enabled analyzer; disabling a fixer pulls each
 *     referenced analyzer UNLESS another enabled fixer still references
 *     it.
 *
 * Only DIRECT edges participate (no transitive closure across the pair
 * graph), both analyzer modes participate identically (user decision
 * 2026-07-22: uniform cascade, `core/ai-name-action` <->
 * `core/name-mismatch` behaves like any probabilistic pair), and a
 * companion already requested or already in the target state is a
 * no-op.
 *
 * Everything here is PURE (same doctrine as `core/jobs/auto-fix-chain.ts`,
 * the queue-side inverse of Modelo B): no config read, no DB, no
 * printing. The two consumers, the CLI toggle
 * (`src/cli/commands/plugins/toggle.ts`) and the BFF PATCH routes
 * (`src/server/routes/plugins.ts`), build the edge list and the enabled
 * probe from their own catalogs and apply their own lock filtering to
 * the additions.
 */

import type { TEnabledResolver } from '../../kernel/config/plugin-resolver.js';
import { installedDefaultEnabled } from '../../kernel/config/plugin-resolver.js';
import type { TExtensionStability } from '../../kernel/extensions/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { matchesQualifiedExtensionFilter } from '../../kernel/util/analyzer-filter.js';
import type { IBuiltInPlugin } from '../../plugins/built-ins.js';
import type { IDiscoveredPlugin } from '../../kernel/types/plugin.js';

/** One direct Modelo B edge: a fixer Action referencing one analyzer. */
export interface IPairEdge {
  /** Qualified id of the fixer Action (`core/ai-verbosity-action`). */
  fixerKey: string;
  /** CANONICAL qualified id of the referenced analyzer. */
  finderKey: string;
}

/** A companion key the pair rule pulled into the toggle. */
export interface IPairToggleAddition {
  /** The companion key. */
  key: string;
  /** The REQUESTED key whose edge pulled it in (for the info line). */
  via: string;
  /** Role of the added key on its edge. */
  role: 'finder' | 'fixer';
}

export interface IPairToggleResult {
  /** `requestedKeys` (original order) + additions appended, deduped. */
  finalKeys: string[];
  /** Only the companions; never contains a requested key. */
  added: IPairToggleAddition[];
}

/**
 * Minimal extension projection the edge collector reads. Both built-in
 * manifests and discovered `ext.instance` shapes project onto it.
 */
export interface IPairEdgeSource {
  /** Qualified extension id (`<plugin>/<ext>`). */
  key: string;
  /** Extension kind; only `action` and `analyzer` rows matter here. */
  kind: string;
  /** Action only: declared `precondition.analyzerIds` (fixer signal). */
  analyzerIds?: readonly string[];
  /** For the installed-default half of the enabled probe. */
  stability?: TExtensionStability;
  defaultEnabled?: boolean;
}

/**
 * Expand a toggle request with the pair rule. `isCurrentlyEnabled` is
 * the effective enable state BEFORE this toggle (config layers +
 * installed default); the requested keys' own flip is overlaid
 * internally (a finder being disabled in the same request counts as
 * disabled inside the refcount), companions never recursively count
 * (direct edges only).
 */
export function expandPairToggle(opts: {
  requestedKeys: readonly string[];
  enabled: boolean;
  edges: readonly IPairEdge[];
  isCurrentlyEnabled: (key: string) => boolean;
}): IPairToggleResult {
  const { requestedKeys, enabled, edges, isCurrentlyEnabled } = opts;
  const requested = new Set(requestedKeys);
  const added: IPairToggleAddition[] = [];
  const addedKeys = new Set<string>();

  const push = (key: string, via: string, role: 'finder' | 'fixer'): void => {
    if (requested.has(key) || addedKeys.has(key)) return;
    // Idempotency: a companion already in the target state needs no write.
    if (isCurrentlyEnabled(key) === enabled) return;
    addedKeys.add(key);
    added.push({ key, via, role });
  };

  if (enabled) collectEnableCompanions(requestedKeys, edges, push);
  else collectDisableCompanions(requestedKeys, requested, edges, isCurrentlyEnabled, push);

  return { finalKeys: [...requestedKeys, ...added.map((a) => a.key)], added };
}

type TPushCompanion = (key: string, via: string, role: 'finder' | 'fixer') => void;

/** Enable direction: symmetric and eager, no refcount. */
function collectEnableCompanions(
  requestedKeys: readonly string[],
  edges: readonly IPairEdge[],
  push: TPushCompanion,
): void {
  for (const key of requestedKeys) {
    for (const edge of edges) {
      if (edge.fixerKey === key) push(edge.finderKey, key, 'finder');
      if (edge.finderKey === key) push(edge.fixerKey, key, 'fixer');
    }
  }
}

/**
 * Disable direction: reference-counted. Requested keys count as already
 * disabled inside the survival test; additions do NOT (no transitive
 * closure).
 */
function collectDisableCompanions(
  requestedKeys: readonly string[],
  requested: ReadonlySet<string>,
  edges: readonly IPairEdge[],
  isCurrentlyEnabled: (key: string) => boolean,
  push: TPushCompanion,
): void {
  const effEnabled = (key: string): boolean => !requested.has(key) && isCurrentlyEnabled(key);
  for (const key of requestedKeys) {
    for (const edge of edges) {
      if (edge.finderKey === key) {
        // Fixer survives while any OTHER edge feeds it a live analyzer.
        const survives = edges.some(
          (e) => e.fixerKey === edge.fixerKey && e.finderKey !== key && effEnabled(e.finderKey),
        );
        if (!survives) push(edge.fixerKey, key, 'fixer');
      }
      if (edge.fixerKey === key) {
        // Analyzer survives while any OTHER enabled fixer references it.
        const survives = edges.some(
          (e) => e.finderKey === edge.finderKey && e.fixerKey !== key && effEnabled(e.fixerKey),
        );
        if (!survives) push(edge.finderKey, key, 'finder');
      }
    }
  }
}

/**
 * Build the flat edge list from projected sources. One edge per
 * (fixer, analyzer) match; an `analyzerIds` array of length n emits up
 * to n edges. Declarations canonicalize to the analyzer's qualified key
 * via the shared filter grammar (`matchesQualifiedExtensionFilter`,
 * bare-or-qualified, the exact grammar of `resolveMatchingFixerIds`).
 * An entry resolving to no known analyzer contributes no edge (same
 * posture as findings injection's benign-race handling).
 */
export function collectPairEdges(sources: readonly IPairEdgeSource[]): IPairEdge[] {
  const analyzers = sources.filter((s) => s.kind === 'analyzer');
  const edges: IPairEdge[] = [];
  for (const action of sources) {
    if (action.kind !== 'action') continue;
    const ids = action.analyzerIds ?? [];
    if (ids.length === 0) continue;
    for (const analyzer of analyzers) {
      if (matchesQualifiedExtensionFilter(analyzer.key, ids)) {
        edges.push({ fixerKey: action.key, finderKey: analyzer.key });
      }
    }
  }
  return edges;
}

/**
 * Project the bundled built-ins onto `IPairEdgeSource` rows. The
 * generated `builtInPlugins` entries spread the source manifests, so
 * `precondition.analyzerIds` / `stability` / `defaultEnabled` are
 * present on the runtime objects.
 */
export function pairEdgeSourcesFromBuiltIns(
  plugins: readonly IBuiltInPlugin[],
): IPairEdgeSource[] {
  const rows: IPairEdgeSource[] = [];
  for (const plugin of plugins) {
    for (const ext of plugin.extensions) {
      const row: IPairEdgeSource = {
        key: qualifiedExtensionId(plugin.id, ext.id),
        kind: ext.kind,
      };
      if (ext.stability !== undefined) row.stability = ext.stability;
      if (ext.defaultEnabled !== undefined) row.defaultEnabled = ext.defaultEnabled;
      const ids = analyzerIdsOf(ext);
      if (ids !== undefined) row.analyzerIds = ids;
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Project discovered (drop-in) plugins onto `IPairEdgeSource` rows.
 * Only plugins whose extensions actually loaded contribute; a plugin
 * discovered as `disabled` / errored has no readable manifests
 * (status-quo limitation, its pairs are invisible to the pair toggle
 * until trusted + loaded), matching every other manifest consumer.
 * `ext.instance` is `unknown` by contract, so fields are read behind
 * shape guards.
 */
export function pairEdgeSourcesFromDiscovered(
  plugins: readonly IDiscoveredPlugin[],
): IPairEdgeSource[] {
  const rows: IPairEdgeSource[] = [];
  for (const plugin of plugins) {
    for (const ext of plugin.extensions ?? []) {
      const row: IPairEdgeSource = {
        key: qualifiedExtensionId(plugin.id, ext.id),
        kind: ext.kind,
      };
      applyInstanceFields(row, ext.instance);
      rows.push(row);
    }
  }
  return rows;
}

/** Read the guarded manifest fields off a discovered `ext.instance`. */
function applyInstanceFields(row: IPairEdgeSource, inst: unknown): void {
  if (typeof inst !== 'object' || inst === null) return;
  const rec = inst as Record<string, unknown>;
  if (typeof rec['stability'] === 'string') {
    row.stability = rec['stability'] as TExtensionStability;
  }
  if (typeof rec['defaultEnabled'] === 'boolean') row.defaultEnabled = rec['defaultEnabled'];
  const ids = analyzerIdsOf(rec);
  if (ids !== undefined) row.analyzerIds = ids;
}

/**
 * Enabled probe over the projected sources: captures each key's
 * installed default (`installedDefaultEnabled(stability, defaultEnabled)`)
 * and threads it through the layered-config resolver. A pure snapshot
 * of PRE-toggle state; the requested-keys overlay lives inside
 * `expandPairToggle`, not here.
 */
export function buildPairEnabledProbe(
  sources: readonly IPairEdgeSource[],
  resolver: TEnabledResolver,
): (key: string) => boolean {
  const defaults = new Map<string, boolean>();
  for (const s of sources) {
    defaults.set(s.key, installedDefaultEnabled(s.stability, s.defaultEnabled));
  }
  return (key) => resolver(key, defaults.get(key) ?? true);
}

/**
 * Map a toggle key to its config dot-path. Every key arriving from the
 * toggle surfaces is the qualified `<plugin>/<ext>` shape (bare ids
 * were expanded to their children upstream), so the path is the
 * per-extension `plugins.<plugin>.extensions.<ext>.enabled`. A bare id
 * (defensive fall-through) maps to the plugin-level
 * `plugins.<plugin>.enabled`. Single shared source for the CLI toggle
 * and the BFF PATCH routes.
 */
export function toEnableConfigKey(id: string): string {
  const slash = id.indexOf('/');
  if (slash < 0) return `plugins.${id}.enabled`;
  return `plugins.${id.slice(0, slash)}.extensions.${id.slice(slash + 1)}.enabled`;
}

/** Read `precondition.analyzerIds` off a manifest-shaped object, guarded. */
function analyzerIdsOf(ext: unknown): readonly string[] | undefined {
  if (typeof ext !== 'object' || ext === null) return undefined;
  const pre = (ext as Record<string, unknown>)['precondition'];
  if (typeof pre !== 'object' || pre === null) return undefined;
  const ids = (pre as Record<string, unknown>)['analyzerIds'];
  if (!Array.isArray(ids)) return undefined;
  const strings = ids.filter((x): x is string => typeof x === 'string');
  return strings.length > 0 ? strings : undefined;
}
