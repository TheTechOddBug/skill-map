/**
 * Plugin runtime loader, single source of truth for any read-side verb
 * that needs plugin extensions on the wire (`sm scan`, `sm graph`).
 *
 * Step 9.1: this is the path that turns "discovered" plugins into
 * "executing" plugins. Until now `PluginLoader` was only invoked by the
 * `sm plugins` introspection verbs; the analysis pipeline ran on built-ins
 * exclusively. This helper closes that gap.
 *
 * Behaviour:
 *
 *   - Discover + load every plugin under the project + user search paths
 *     (or `--plugin-dir <path>` override).
 *   - Layer the enabled-resolver: settings.json baseline + DB override
 *     (config_plugins). Disabled plugins are surfaced but not run.
 *   - Bucket loaded extensions by kind into the same `IBuiltIns` shape
 *     the orchestrator already consumes. Caller merges with built-ins.
 *   - Convert failure modes into stderr-ready diagnostic strings. The
 *     kernel keeps booting on bad plugins, they never abort the verb.
 *
 * Returns the `Extension[]` manifest rows alongside the runtime instances
 * so the Registry can register them for `sm help` / `sm plugins list`
 * introspection without re-reading the manifests.
 *
 * Lives under `core/runtime/` so the BFF (`src/server/`) can consume it
 * without crossing into `src/cli/`. Historic `cli/util/plugin-runtime.ts`
 * keeps working through a re-export shim there.
 */

import type {
  IProvider,
  IExtractor,
  IFormatter,
  IHook,
  IAnalyzer,
  IAction,
} from '../../../kernel/extensions/index.js';
import type { IRegisteredAnnotationKey } from '../../../kernel/types/annotation-catalog.js';
import type { IRegisteredViewContribution } from '../../../kernel/types/view-catalog.js';
import type { IExtension } from '../../../kernel/registry.js';
import { PLUGIN_LOADER_TEXTS } from '../../../kernel/i18n/plugin-loader.texts.js';
import {
  createPluginLoader,
  installedSpecVersion,
  type IPluginLoaderOptions,
} from '../../../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../../../kernel/adapters/schema-validators.js';
import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';
import { tx } from '../../../kernel/util/tx.js';
import type { IPrinter } from '../printer.js';
import type { IRuntimeContext } from '../runtime-context.js';

import {
  buildResolverInputs,
  defaultResolveEnabled,
} from './resolver.js';
import { makeImportTrustResolver } from '../../../kernel/config/plugin-resolver.js';
import { bucketLoaded } from './bucketing.js';
import {
  emitWarnings,
  formatWarning,
  resolveRuntimeContext,
  resolveSearchPaths,
} from './warnings.js';

export interface ILoadPluginRuntimeOptions {
  /** Explicit override; bypasses the project plugins directory. Tests use this. */
  pluginDir?: string;
  /**
   * Optional override for the runtime context that drives `cwd` /
   * path-helpers. When omitted, `defaultRuntimeContext()` is used
   * (the existing behavior). Threaded through to `resolveSearchPaths`
   * and `buildEnabledResolver` so a single boot-time override steers
   * BOTH plugin discovery AND config / DB resolution.
   *
   * The BFF (`src/server/index.ts`) passes its already-resolved
   * `runtimeContext` here so a test that boots `createServer()` with
   * an explicit tempdir cwd actually has plugin discovery walk that
   * tempdir's `.skill-map/plugins/` instead of the real
   * `process.cwd()`. Step 9.6 review queue R14.
   */
  runtimeContext?: IRuntimeContext;
}

export interface IPluginRuntime {
  /** Bucketed runtime extensions keyed by kind, ready to merge with `builtIns()`. */
  extensions: {
    providers: IProvider[];
    extractors: IExtractor[];
    analyzers: IAnalyzer[];
    formatters: IFormatter[];
    /**
     * Loaded hook extensions (spec § A.11). Surfaced for the dispatcher
     * the orchestrator threads through the scan pipeline; built-ins
     * carry no hooks at this bump (the kind exists; concrete built-in
     * hooks land separately when demand surfaces).
     */
    hooks: IHook[];
    /**
     * Loaded action extensions. Surfaced so the scan composer can hand
     * enabled actions to the orchestrator's projection pass: an Action
     * with a scan-time `project()` self-projection emits its own
     * `inspector.action.button` during the contribution phase. Actions
     * that only carry `invoke` (no `project`) still bucket here, the
     * projection pass simply skips them.
     */
    actions: IAction[];
  };
  /**
   * Step 9.6.6, flat catalog of plugin-contributed annotation keys.
   * Aggregated across every loaded extension's `annotationContributions`
   * map. Pure data; consumers (kernel runtime catalog, BFF endpoint)
   * forward to `kernel.setRegisteredAnnotationKeys(...)`. Built-ins do
   * not contribute (their fields live in `annotations.schema.json`).
   */
  annotationContributions: IRegisteredAnnotationKey[];
  /**
   * Step 11.x, flat catalog of plugin-contributed view contributions.
   * Aggregated across every loaded extension's `viewContributions` map.
   * Each row carries `(pluginId, extensionId, contributionId, contract,
   * label?, tooltip?, icon?, emptyText?, emitWhenEmpty)`. Pure data;
   * consumers (kernel runtime catalog, BFF `/api/contributions/registered`)
   * forward to `kernel.setRegisteredViewContributions(...)`. The qualified
   * id `<pluginId>/<extensionId>/<contributionId>` is structurally unique
   * by construction (the manifest Record key is unique within an
   * extension; extensionId qualifies within a plugin; pluginId qualifies
   * globally) so no cross-plugin collision detection is needed,
   * different from annotation contributions where root-exclusive keys
   * can clash.
   */
  viewContributions: IRegisteredViewContribution[];
  /** Manifest rows for the Registry. One per loaded plugin extension. */
  manifests: IExtension[];
  /**
   * Stderr-ready warning lines, one per failed / incompatible plugin.
   * Already prefixed with the plugin id and status. Caller writes them
   * verbatim before doing real work. `disabled` plugins are NOT in here
   * (it's the user's intent, not a problem).
   */
  warnings: string[];
  /** Raw discovery output, for callers (`sm plugins doctor`) that need it. */
  discovered: IDiscoveredPlugin[];
  /**
   * Resolver used to layer `config_plugins` (DB) over `settings.json`.
   * Surfaced so call sites that compose built-ins (`composeScanExtensions`,
   * `composeFormatters`) can apply the same precedence to the
   * `core/<ext-id>` keys without rebuilding the resolver. Returns `true`
   * for any id that has no explicit override (the default-enabled
   * fall-back). Always populated, `emptyPluginRuntime()` returns a
   * resolver that says everything is enabled.
   */
  resolveEnabled: (id: string) => boolean;
  /**
   * Forward every warning row through `printer.warn`. The single
   * canonical surface for advisories from a plugin runtime,
   * supersedes the hand-rolled `for (const w of runtime.warnings)
   * stream.write(\`${w}\n\`)` loop every read-side verb used to
   * spell out (printer.warn already routes to stderr).
   */
  emitWarnings: (printer: IPrinter) => void;
}

/**
 * Discover and load every plugin reachable from the project scope,
 * with the layered enabled-resolver applied.
 *
 * Never throws, a bad search path or a corrupt DB row degrades to a
 * warning and an empty (or partial) runtime. The verb that calls this
 * keeps running on whatever loaded successfully.
 *
 * Complexity comes from the orchestration steps (resolve context →
 * search paths → resolver build → loader run → per-plugin status
 * dispatch → root-exclusivity check). Splitting the per-plugin loop
 * into a helper would scatter the runtime population across two
 * modules with no other consumer.
 */
// eslint-disable-next-line complexity
export async function loadPluginRuntime(
  opts: ILoadPluginRuntimeOptions = {},
): Promise<IPluginRuntime> {
  // Resolve the runtime context once and thread it through every
  // helper that previously called `defaultRuntimeContext()` directly.
  // R14, when the BFF (or a test) provides an explicit override, both
  // plugin discovery (`resolveSearchPaths`) and config / DB resolution
  // (`buildEnabledResolver`) MUST honour the same override; otherwise
  // a `runtimeContext: { cwd: <tempdir>, ... }` boot would silently
  // walk the real `process.cwd()` for plugins.
  const ctx = resolveRuntimeContext(opts);
  const searchPaths = resolveSearchPaths(opts, ctx);
  const validators = loadSchemaValidators();

  let resolveEnabled: ((id: string) => boolean) | undefined;
  let dbOverrides: Map<string, boolean> | undefined;
  try {
    const inputs = await buildResolverInputs(ctx);
    resolveEnabled = inputs.resolveEnabled;
    dbOverrides = inputs.dbOverrides;
  } catch {
    // Config / DB read failure here is non-fatal, fall through with
    // the loader's default ("every plugin enabled"). The actual scan
    // pipeline still runs; the user gets `sm plugins doctor` as the
    // dedicated diagnostic surface. `dbOverrides` stays undefined, so the
    // trust gate below trusts nothing (fails closed, the safe default).
  }

  const loaderOpts: IPluginLoaderOptions = {
    searchPaths,
    validators,
    specVersion: installedSpecVersion(),
  };
  if (resolveEnabled) loaderOpts.resolveEnabled = resolveEnabled;
  // Import-trust gate (security boundary, H1). Only project-local
  // discovery is gated: an explicit `--plugin-dir` is the operator
  // pointing the loader at code on purpose, while project discovery is
  // the clone-and-scan path where a hostile repo's `.skill-map/plugins/`
  // must NOT auto-execute. `dbOverrides` defaults to empty (trust
  // nothing) when the config/DB read failed above, so the gate fails
  // closed rather than open.
  if (!opts.pluginDir) {
    loaderOpts.resolveImportTrust = makeImportTrustResolver(dbOverrides ?? new Map());
  }
  const loader = createPluginLoader(loaderOpts);
  const discovered = await loader.discoverAndLoadAll();

  const runtime: IPluginRuntime = {
    extensions: { providers: [], extractors: [], analyzers: [], formatters: [], hooks: [], actions: [] },
    annotationContributions: [],
    viewContributions: [],
    manifests: [],
    warnings: [],
    discovered,
    resolveEnabled: resolveEnabled ?? defaultResolveEnabled,
    emitWarnings(printer) { emitWarnings(this, printer); },
  };

  for (const plugin of discovered) {
    if (plugin.status === 'enabled') {
      bucketLoaded(plugin.extensions ?? [], runtime, plugin.manifest?.order);
      continue;
    }
    if (plugin.status === 'disabled') continue;
    runtime.warnings.push(formatWarning(plugin));
  }

  // H1: one-time aggregate notice when project-local plugins were found
  // on disk but left unexecuted for lack of local trust. Keeps the
  // common case (no plugins) silent while making the "your cloned repo
  // ships plugins, none ran" situation discoverable.
  const untrustedCount = discovered.filter((p) => p.untrusted === true).length;
  if (untrustedCount > 0) {
    runtime.warnings.push(
      tx(PLUGIN_LOADER_TEXTS.untrustedPluginsFoundNotice, { count: untrustedCount }),
    );
  }

  // Spec § 9.6.6, cross-plugin collision detection on annotation
  // contributions. A `(key, location: 'root', ownership: 'exclusive')`
  // tuple may appear at most once across the entire enabled plugin
  // surface. Two plugins claiming the same root-exclusive key is a
  // FATAL startup error (see `AnnotationContributionConflictError`):
  // either annotated `.sm` files become non-deterministically routed,
  // which violates the spec invariant that plugin namespaces are
  // disjoint. The kernel does NOT boot in this state, the host (CLI
  // / BFF) propagates and exits non-zero.
  enforceRootExclusivity(runtime.annotationContributions);

  return runtime;
}

/**
 * Step 9.6.6, fatal error raised when two or more plugins claim the
 * same `(key, location: 'root', ownership: 'exclusive')` tuple.
 *
 * The kernel orchestrator and every host (CLI verb, BFF startup, watch
 * mode) MUST refuse to boot when this throws. It is intentionally a
 * separate class from generic `Error` so the CLI's top-level error
 * handler can match on `instanceof` and render a clear stderr message
 * before exiting non-zero.
 */
export class AnnotationContributionConflictError extends Error {
  /** The colliding root-exclusive key. */
  readonly key: string;
  /** Plugin ids that claimed the key (sorted, deterministic). */
  readonly plugins: readonly string[];

  constructor(key: string, plugins: readonly string[]) {
    super(
      tx(PLUGIN_LOADER_TEXTS.fatalAnnotationRootCollision, {
        key,
        plugins: plugins.join(', '),
      }),
    );
    this.name = 'AnnotationContributionConflictError';
    this.key = key;
    this.plugins = plugins;
  }
}

/**
 * Walk the aggregated catalog and throw when any root-exclusive key is
 * claimed by more than one plugin. Shared root keys are not allowed by
 * construction (rejected at per-extension validation in the loader);
 * this pass only catches cross-plugin clashes on the legitimately-
 * exclusive root surface. Namespaced contributions (default) are
 * isolated by their `<plugin-id>:` prefix and never collide.
 */
function enforceRootExclusivity(catalog: readonly IRegisteredAnnotationKey[]): void {
  const byKey = new Map<string, string[]>();
  for (const entry of catalog) {
    if (entry.location !== 'root' || entry.ownership !== 'exclusive') continue;
    const list = byKey.get(entry.key);
    if (list) list.push(entry.pluginId);
    else byKey.set(entry.key, [entry.pluginId]);
  }
  for (const [key, plugins] of byKey) {
    if (plugins.length < 2) continue;
    const sorted = [...new Set(plugins)].sort();
    throw new AnnotationContributionConflictError(key, sorted);
  }
}

/**
 * Empty runtime, the right answer for `--no-plugins` paths and any caller
 * that wants the same shape without a discovery pass. Cheaper than
 * calling `loadPluginRuntime` against an empty search path.
 */
export function emptyPluginRuntime(): IPluginRuntime {
  const runtime: IPluginRuntime = {
    extensions: { providers: [], extractors: [], analyzers: [], formatters: [], hooks: [], actions: [] },
    annotationContributions: [],
    viewContributions: [],
    manifests: [],
    warnings: [],
    discovered: [],
    resolveEnabled: defaultResolveEnabled,
    emitWarnings(printer) { emitWarnings(this, printer); },
  };
  return runtime;
}
