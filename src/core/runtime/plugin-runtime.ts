/**
 * Plugin runtime loader — single source of truth for any read-side verb
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
 *     kernel keeps booting on bad plugins — they never abort the verb.
 *
 * Returns the `Extension[]` manifest rows alongside the runtime instances
 * so the Registry can register them for `sm help` / `sm plugins list`
 * introspection without re-reading the manifests.
 *
 * Lives under `core/runtime/` so the BFF (`src/server/`) can consume it
 * without crossing into `src/cli/`. Historic `cli/util/plugin-runtime.ts`
 * keeps working through a re-export shim there.
 */

import { resolve } from 'node:path';

import type {
  IProvider,
  IExtractor,
  IFormatter,
  IHook,
  IAnalyzer,
  IAnnotationContribution,
} from '../../kernel/extensions/index.js';
import type { IRegisteredAnnotationKey } from '../../kernel/types/annotation-catalog.js';
import type { IRegisteredViewContribution, IViewContribution, TSlotName } from '../../kernel/types/view-catalog.js';
import type { Extension } from '../../kernel/registry.js';
import { PLUGIN_LOADER_TEXTS } from '../../kernel/i18n/plugin-loader.texts.js';
import {
  builtInBundles,
  listBuiltIns,
  type IBuiltInBundle,
  type TBuiltInExtension,
} from '../../built-in-plugins/built-ins.js';
import {
  createPluginLoader,
  installedSpecVersion,
  type IPluginLoaderOptions,
} from '../../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { makeEnabledResolver } from '../../kernel/config/plugin-resolver.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import type {
  IDiscoveredPlugin,
  ILoadedExtension,
} from '../../kernel/types/plugin.js';
import { bucketByKind } from '../../kernel/util/bucket-by-kind.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { truncateHead } from '../../kernel/util/text.js';
import type { IPrinter } from './printer.js';
import {
  defaultProjectPluginsDir,
  defaultUserPluginsDir,
  resolveDbPath,
} from '../paths/db-path.js';
import { tryWithSqlite } from '../sqlite/with-sqlite.js';
import { PLUGIN_RUNTIME_TEXTS } from './i18n/plugin-runtime.texts.js';
import { defaultRuntimeContext, type IRuntimeContext } from './runtime-context.js';

export interface ILoadPluginRuntimeOptions {
  /** Resolution scope. `'global'` reads `~/.skill-map/...` only. */
  scope: 'project' | 'global';
  /** Explicit override; bypasses the project + user search paths. Tests use this. */
  pluginDir?: string;
  /**
   * Optional override for the runtime context that drives `cwd` /
   * `homedir` / path-helpers. When omitted, `defaultRuntimeContext()`
   * is used (the existing behavior). Threaded through to
   * `resolveSearchPaths` and `buildEnabledResolver` so a single
   * boot-time override steers BOTH plugin discovery AND
   * config / DB resolution.
   *
   * The BFF (`src/server/index.ts`) passes its already-resolved
   * `runtimeContext` here so a test that boots `createServer()` with
   * an explicit tempdir cwd actually has plugin discovery walk that
   * tempdir's `.skill-map/plugins/` instead of the real
   * `process.cwd()`. Step 9.6 review queue R14.
   */
  runtimeContext?: IRuntimeContext;
}

export interface IPluginRuntimeBundle {
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
  };
  /**
   * Step 9.6.6 — flat catalog of plugin-contributed annotation keys.
   * Aggregated across every loaded extension's `annotationContributions`
   * map. Pure data; consumers (kernel runtime catalog, BFF endpoint)
   * forward to `kernel.setRegisteredAnnotationKeys(...)`. Built-ins do
   * not contribute (their fields live in `annotations.schema.json`).
   */
  annotationContributions: IRegisteredAnnotationKey[];
  /**
   * Step 11.x — flat catalog of plugin-contributed view contributions.
   * Aggregated across every loaded extension's `viewContributions` map.
   * Each row carries `(pluginId, extensionId, contributionId, contract,
   * label?, tooltip?, icon?, emptyText?, emitWhenEmpty)`. Pure data;
   * consumers (kernel runtime catalog, BFF `/api/contributions/registered`)
   * forward to `kernel.setRegisteredViewContributions(...)`. The qualified
   * id `<pluginId>/<extensionId>/<contributionId>` is structurally unique
   * by construction (the manifest Record key is unique within an
   * extension; extensionId qualifies within a plugin; pluginId qualifies
   * globally) so no cross-plugin collision detection is needed —
   * different from annotation contributions where root-exclusive keys
   * can clash.
   */
  viewContributions: IRegisteredViewContribution[];
  /** Manifest rows for the Registry. One per loaded plugin extension. */
  manifests: Extension[];
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
   * fall-back). Always populated — `emptyPluginRuntime()` returns a
   * resolver that says everything is enabled.
   */
  resolveEnabled: (id: string) => boolean;
  /**
   * Forward every warning row through `printer.warn`. The single
   * canonical surface for advisories from a plugin runtime —
   * supersedes the hand-rolled `for (const w of bundle.warnings)
   * stream.write(\`${w}\n\`)` loop every read-side verb used to
   * spell out (printer.warn already routes to stderr).
   */
  emitWarnings: (printer: IPrinter) => void;
}

/**
 * Discover and load every plugin reachable from the chosen scope, with
 * the layered enabled-resolver applied.
 *
 * Never throws — a bad search path or a corrupt DB row degrades to a
 * warning and an empty (or partial) bundle. The verb that calls this
 * keeps running on whatever loaded successfully.
 */
export async function loadPluginRuntime(
  opts: ILoadPluginRuntimeOptions,
): Promise<IPluginRuntimeBundle> {
  // Resolve the runtime context once and thread it through every
  // helper that previously called `defaultRuntimeContext()` directly.
  // R14 — when the BFF (or a test) provides an explicit override, both
  // plugin discovery (`resolveSearchPaths`) and config / DB resolution
  // (`buildEnabledResolver`) MUST honour the same override; otherwise
  // a `runtimeContext: { cwd: <tempdir>, ... }` boot would silently
  // walk the real `process.cwd()` for plugins.
  const ctx = resolveRuntimeContext(opts);
  const searchPaths = resolveSearchPaths(opts, ctx);
  const validators = loadSchemaValidators();

  let resolveEnabled: ((id: string) => boolean) | undefined;
  try {
    resolveEnabled = await buildEnabledResolver(opts.scope, ctx);
  } catch {
    // Config / DB read failure here is non-fatal — fall through with
    // the loader's default ("every plugin enabled"). The actual scan
    // pipeline still runs; the user gets `sm plugins doctor` as the
    // dedicated diagnostic surface.
  }

  const loaderOpts: IPluginLoaderOptions = {
    searchPaths,
    validators,
    specVersion: installedSpecVersion(),
  };
  if (resolveEnabled) loaderOpts.resolveEnabled = resolveEnabled;
  const loader = createPluginLoader(loaderOpts);
  const discovered = await loader.discoverAndLoadAll();

  const bundle: IPluginRuntimeBundle = {
    extensions: { providers: [], extractors: [], analyzers: [], formatters: [], hooks: [] },
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
      bucketLoaded(plugin.extensions ?? [], bundle);
      continue;
    }
    if (plugin.status === 'disabled') continue;
    bundle.warnings.push(formatWarning(plugin));
  }

  // Spec § 9.6.6 — cross-plugin collision detection on annotation
  // contributions. A `(key, location: 'root', ownership: 'exclusive')`
  // tuple may appear at most once across the entire enabled plugin
  // surface. Two plugins claiming the same root-exclusive key is a
  // FATAL startup error (see `AnnotationContributionConflictError`):
  // either annotated `.sm` files become non-deterministically routed,
  // which violates the spec invariant that plugin namespaces are
  // disjoint. The kernel does NOT boot in this state — the host (CLI
  // / BFF) propagates and exits non-zero.
  enforceRootExclusivity(bundle.annotationContributions);

  return bundle;
}

/**
 * Step 9.6.6 — fatal error raised when two or more plugins claim the
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
 * Empty bundle, the right answer for `--no-plugins` paths and any caller
 * that wants the same shape without a discovery pass. Cheaper than
 * calling `loadPluginRuntime` against an empty search path.
 */
export function emptyPluginRuntime(): IPluginRuntimeBundle {
  const bundle: IPluginRuntimeBundle = {
    extensions: { providers: [], extractors: [], analyzers: [], formatters: [], hooks: [] },
    annotationContributions: [],
    viewContributions: [],
    manifests: [],
    warnings: [],
    discovered: [],
    resolveEnabled: defaultResolveEnabled,
    emitWarnings(printer) { emitWarnings(this, printer); },
  };
  return bundle;
}

/**
 * Forward every warning row through `printer.warn`. Each warning is
 * already a complete diagnostic line (rendered by `formatWarning`); we
 * append the trailing newline here so the catalogue stays
 * trailing-newline-free (matches the convention in
 * `cli/util/printer.ts`).
 */
function emitWarnings(bundle: IPluginRuntimeBundle, printer: IPrinter): void {
  for (const warn of bundle.warnings) {
    printer.warn(`${warn}\n`);
  }
}

/** Default-enabled fall-back: every id is enabled when no overrides exist. */
function defaultResolveEnabled(_id: string): boolean {
  return true;
}

/**
 * Granularity-aware filter for built-in bundles. Honours the spec
 * promise that "no extension is privileged" — every built-in is
 * removable via `config_plugins` / `settings.json`.
 *
 * Resolution rules (mirror `kernel/config/plugin-resolver.ts`):
 *
 *   - bundle granularity (`claude`): the user toggles the namespace
 *     once; the lookup key is `<bundle.id>` — every extension in the
 *     bundle follows. A user-set DB / settings entry under
 *     `<bundle.id>/<ext.id>` is silently ignored (the granularity says
 *     "this bundle is one knob"); the validation that catches that as
 *     a CLI input error happens upstream in `sm plugins enable/disable`.
 *   - extension granularity (`core`): the lookup key is the qualified
 *     id `<bundle.id>/<ext.id>`. Each extension is independently
 *     toggle-able.
 *
 * Defaults to `true` for any id without an explicit override.
 */
export function isBuiltInExtensionEnabled(
  bundle: IBuiltInBundle,
  ext: TBuiltInExtension,
  resolveEnabled: (id: string) => boolean,
): boolean {
  return isBundleEntryEnabled(bundle, ext.id, resolveEnabled);
}

/**
 * Underlying primitive — works on the plain extension `id` rather than
 * a typed extension instance, so it can be reused from manifest-side
 * filters (`filterBuiltInManifests`) where the value is `IPluginManifest`,
 * not `TBuiltInExtension`. Same toggle semantics as
 * `isBuiltInExtensionEnabled`.
 */
function isBundleEntryEnabled(
  bundle: IBuiltInBundle,
  extId: string,
  resolveEnabled: (id: string) => boolean,
): boolean {
  if (bundle.granularity === 'bundle') {
    return resolveEnabled(bundle.id);
  }
  return resolveEnabled(qualifiedExtensionId(bundle.id, extId));
}

/**
 * Conformance-only kill-switches (mirrored in the
 * `conformance-case.schema.json#/properties/setup` toggles). Each flag
 * drops every extension of its kind from the scan composer regardless
 * of granularity gates and `--no-built-ins`. Production callers MUST
 * NOT set these — they exist so the conformance runner can drive the
 * `kernel-empty-boot` invariant (and any future case that needs an
 * isolated kind) without depending on fixture content being empty.
 *
 * Conformance is invoked as a child `sm scan` process with
 * `SKILL_MAP_DISABLE_ALL_{PROVIDERS,EXTRACTORS,RULES}=1` env vars. The
 * CLI adapter (`cli/util/conformance-env.ts: readConformanceKillSwitches`)
 * reads those env vars at the process boundary and threads the
 * resolved booleans here. The composer itself stays
 * environment-agnostic — keeping `core/` free of `process.env` reads
 * (audit M1) and letting the BFF compose extensions deterministically
 * regardless of the developer's shell exports.
 */
export interface IConformanceKillSwitches {
  providers?: boolean;
  extractors?: boolean;
  analyzers?: boolean;
}

/**
 * Compose the `IScanExtensions` shape the orchestrator consumes. Built-ins
 * load conditionally (gated by `--no-built-ins`); plugin extensions always
 * fold in, even under `--no-built-ins` — the user wants a stripped-down
 * pipeline of "just my plugins" in that combo. To get a fully empty
 * pipeline (kernel-empty-boot) the caller passes both `--no-built-ins`
 * AND `--no-plugins`.
 *
 * Built-ins are also gated by `pluginRuntime.resolveEnabled`: a user that
 * disables `claude` (bundle granularity) drops the four Claude
 * extensions; a user that disables `core/superseded` (extension
 * granularity) drops only that analyzer. `--no-built-ins` is the macro
 * override that wins when both layers say "skip".
 *
 * `killSwitches` (optional, conformance-only) wins over every other
 * gate — when set, drops every extension of the chosen kind from the
 * composed bundle, including user plugins. Production callers leave
 * the field undefined; the conformance runner reads its env-var
 * representation at the CLI adapter and threads the resolved booleans
 * in.
 *
 * Returns `undefined` when both halves are empty so the orchestrator
 * follows its zero-extension code path.
 */
// eslint-disable-next-line complexity
export function composeScanExtensions(opts: {
  noBuiltIns: boolean;
  pluginRuntime: IPluginRuntimeBundle;
  killSwitches?: IConformanceKillSwitches;
}): {
  providers: IProvider[];
  extractors: IExtractor[];
  analyzers: IAnalyzer[];
  hooks: IHook[];
} | undefined {
  const providers: IProvider[] = [];
  const extractors: IExtractor[] = [];
  const analyzers: IAnalyzer[] = [];
  const hooks: IHook[] = [];

  if (!opts.noBuiltIns) {
    accumulateBuiltInScanExtensions(
      { providers, extractors, analyzers, hooks },
      opts.pluginRuntime.resolveEnabled,
    );
  }
  providers.push(...opts.pluginRuntime.extensions.providers);
  extractors.push(...opts.pluginRuntime.extensions.extractors);
  analyzers.push(...opts.pluginRuntime.extensions.analyzers);
  hooks.push(...opts.pluginRuntime.extensions.hooks);

  // Conformance kill-switches. Applied last so they trump every other
  // gate (granularity, --no-built-ins, plugin enable/disable).
  const finalProviders = opts.killSwitches?.providers === true ? [] : providers;
  const finalExtractors = opts.killSwitches?.extractors === true ? [] : extractors;
  const finalAnalyzers = opts.killSwitches?.analyzers === true ? [] : analyzers;

  // `kernel-empty-boot` invariant (spec § Boot invariant): zero
  // Providers + Extractors + Analyzers → return `undefined` so the
  // orchestrator follows its zero-extension code path. Hooks are
  // intentionally excluded from this check: a hook that subscribes
  // ONLY to CLI-driven triggers (`boot`, `shutdown`) reaches this
  // composer through the built-in bundle but the scan dispatcher
  // would never invoke it (those triggers fire from
  // `cli/entry.ts`, not from `runScan`). Preserving the empty-boot
  // shape regardless of hook presence keeps the conformance case
  // honest while letting `core/update-check` (the first such hook)
  // ride along for the CLI-side dispatcher to pick up.
  if (
    finalProviders.length === 0 &&
    finalExtractors.length === 0 &&
    finalAnalyzers.length === 0
  ) {
    return undefined;
  }
  return {
    providers: finalProviders,
    extractors: finalExtractors,
    analyzers: finalAnalyzers,
    hooks,
  };
}

/**
 * Walk every built-in bundle, drop disabled extensions per the
 * resolver, and bucket the survivors into the per-kind arrays.
 * Formatters are consumed by `composeFormatters`, not scan, so they
 * are skipped here even if the bundle ships them.
 */
// Discriminated-union dispatcher — one branch per `ext.kind` plus the
// disabled-guard up front. Cyclomatic count comes from the six-kind
// switch + the per-bundle iteration; splitting per kind would scatter
// the dispatch table without making the algorithm clearer.
// eslint-disable-next-line complexity
function accumulateBuiltInScanExtensions(
  buckets: { providers: IProvider[]; extractors: IExtractor[]; analyzers: IAnalyzer[]; hooks: IHook[] },
  resolveEnabled: (id: string) => boolean,
): void {
  for (const bundle of builtInBundles) {
    for (const ext of bundle.extensions) {
      if (!isBuiltInExtensionEnabled(bundle, ext, resolveEnabled)) continue;
      switch (ext.kind) {
        case 'provider':
          buckets.providers.push(ext);
          break;
        case 'extractor':
          buckets.extractors.push(ext);
          break;
        case 'analyzer':
          buckets.analyzers.push(ext);
          break;
        case 'hook':
          buckets.hooks.push(ext);
          break;
        case 'action':
          // Actions dispatch via the job subsystem (Step 10), not the
          // scan pipeline. Skip here; their manifests still register.
          break;
        case 'formatter':
          // Formatters are consumed by `composeFormatters`, not scan.
          break;
        default: {
          const _exhaustive: never = ext;
          throw new Error(`Unhandled built-in extension kind: ${String((_exhaustive as { kind?: string }).kind)}`);
        }
      }
    }
  }
}

/**
 * Same idea as `composeScanExtensions` but for formatters (consumed by
 * `sm graph`). Built-ins layer first, plugin formatters after — first
 * registration wins on a `formatId` collision, which keeps the kernel's
 * defaults predictable when a plugin claims an existing format. Built-in
 * formatters respect the same granularity filter as scan-side built-ins.
 */
export function composeFormatters(opts: {
  noBuiltIns?: boolean;
  pluginRuntime: IPluginRuntimeBundle;
}): IFormatter[] {
  const noBuiltIns = opts.noBuiltIns ?? false;
  const out: IFormatter[] = [];
  if (!noBuiltIns) {
    for (const bundle of builtInBundles) {
      for (const ext of bundle.extensions) {
        if (ext.kind !== 'formatter') continue;
        if (!isBuiltInExtensionEnabled(bundle, ext, opts.pluginRuntime.resolveEnabled)) continue;
        out.push(ext);
      }
    }
  }
  out.push(...opts.pluginRuntime.extensions.formatters);
  return out;
}

/**
 * Register the built-in + plugin manifests against the kernel registry,
 * honouring the same `--no-built-ins` macro every read-side verb
 * understands. Five call sites (`scan-runner`, `watch`, `scan-compare`,
 * `server/watcher`, `init`) used to spell out the exact same three-line
 * dance:
 *
 *   const enabledBuiltIns = filterBuiltInManifests(listBuiltIns(),
 *     pluginRuntime.resolveEnabled);
 *   for (const m of enabledBuiltIns) kernel.registry.register(m);
 *   for (const m of pluginRuntime.manifests) kernel.registry.register(m);
 *
 * Drift was inevitable (a future built-in granularity tweak would have
 * to land on five files at once). The helper consolidates the dance
 * so a single edit moves every consumer in lock-step.
 */
// Complexity counts the per-bundle / per-extension nested walks for
// the built-in catalog merge plus the dual `setRegistered*` guards.
// Splitting the merge body into a private helper would scatter the
// path-of-truth without making the algorithm clearer.
// eslint-disable-next-line complexity
export function registerEnabledExtensions(
  kernel: {
    registry: { register: (m: Extension) => void };
    setRegisteredAnnotationKeys?: (entries: readonly IRegisteredAnnotationKey[]) => void;
    setRegisteredViewContributions?: (entries: readonly IRegisteredViewContribution[]) => void;
  },
  pluginRuntime: IPluginRuntimeBundle,
  options: { noBuiltIns?: boolean } = {},
): void {
  const noBuiltIns = options.noBuiltIns === true;
  if (!noBuiltIns) {
    const enabledBuiltIns = filterBuiltInManifests(
      listBuiltIns(),
      pluginRuntime.resolveEnabled,
    );
    for (const manifest of enabledBuiltIns) kernel.registry.register(manifest);
  }
  for (const manifest of pluginRuntime.manifests) kernel.registry.register(manifest);
  // Step 9.6.6 — publish the runtime catalog so verbs that need
  // autocomplete data (BFF endpoint in the next sub-step, future
  // `sm annotations list`) can read it without re-walking the plugin
  // surface. Optional chaining tolerates legacy callers (tests, hosts
  // that build a kernel-shaped object by hand).
  if (kernel.setRegisteredAnnotationKeys) {
    kernel.setRegisteredAnnotationKeys(pluginRuntime.annotationContributions);
  }
  // Step 11.x — same publish for view contributions. Optional chaining
  // tolerates legacy callers (tests, kernels created before the field
  // was added).
  //
  // Built-ins fold in here too: `pluginRuntime.viewContributions` is
  // collected only from USER plugins (via `bucketLoaded`); built-in
  // bundles never traverse `bucketLoaded`, so their declared
  // `viewContributions` would otherwise be invisible to the kernel
  // catalog. Walk the enabled built-in extension instances and merge.
  if (kernel.setRegisteredViewContributions) {
    const merged: IRegisteredViewContribution[] = [...pluginRuntime.viewContributions];
    if (!noBuiltIns) {
      for (const bundle of builtInBundles) {
        for (const ext of bundle.extensions) {
          if (!isBundleEntryEnabled(bundle, ext.id, pluginRuntime.resolveEnabled)) continue;
          collectViewContributions(ext.pluginId, ext.id, ext, merged);
        }
      }
    }
    kernel.setRegisteredViewContributions(merged);
  }
}

/**
 * Phase 3 / View contribution system — extract every qualified
 * contribution id (`<pluginId>/<extensionId>/<contributionId>`)
 * declared by the composed extractors + analyzers. Threaded into
 * `IPersistOptions.registeredContributionKeys` so the
 * `scan_contributions` upsert can drop rows belonging to
 * plugins / extensions / contributions no longer in the catalog.
 *
 * Returns an empty set when `composed` is undefined (zero-extension
 * scans) so the caller can pass it through unconditionally — the
 * adapter then falls back to the legacy "no catalog sweep" path.
 */
export function collectRegisteredContributionKeys(
  composed: ReturnType<typeof composeScanExtensions>,
): Set<string> {
  const keys = new Set<string>();
  if (!composed) return keys;
  for (const ext of [...composed.extractors, ...composed.analyzers]) {
    const raw = (ext as { viewContributions?: unknown }).viewContributions;
    if (typeof raw !== 'object' || raw === null) continue;
    for (const [contributionId, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      keys.add(`${ext.pluginId}/${ext.id}/${contributionId}`);
    }
  }
  return keys;
}

/**
 * Granularity-aware filter for built-in registry rows. Used by call
 * sites (scan / scan-compare / watch) that register built-in manifests
 * via `listBuiltIns()` BEFORE the orchestrator runs — without this
 * filter a user-disabled built-in would appear in `sm help` /
 * `sm plugins list` as if it were live, contradicting the granularity
 * model.
 */
export function filterBuiltInManifests(
  manifests: Extension[],
  resolveEnabled: (id: string) => boolean,
): Extension[] {
  // Build a per-bundle index so the filter respects whichever granularity
  // each built-in row's owning bundle declared. The index is rebuilt
  // every call (cheap — two bundles, eleven extensions).
  const bundleByPluginId = new Map<string, IBuiltInBundle>();
  for (const bundle of builtInBundles) bundleByPluginId.set(bundle.id, bundle);

  return manifests.filter((m) => {
    const bundle = bundleByPluginId.get(m.pluginId);
    if (!bundle) return true; // not a built-in row — leave it alone.
    return isBundleEntryEnabled(bundle, m.id, resolveEnabled);
  });
}

/**
 * Resolve the runtime context to use for this `loadPluginRuntime` call.
 * Honours an explicit override (the BFF or a test passing `runtimeContext`
 * to steer plugin discovery + config / DB resolution at the same tempdir),
 * else falls back to `defaultRuntimeContext()` exactly as the pre-R14
 * behaviour did.
 */
function resolveRuntimeContext(opts: ILoadPluginRuntimeOptions): IRuntimeContext {
  return opts.runtimeContext ?? defaultRuntimeContext();
}

/** Project + user search paths, or the explicit override. */
function resolveSearchPaths(
  opts: ILoadPluginRuntimeOptions,
  ctx: IRuntimeContext,
): string[] {
  if (opts.pluginDir) return [resolve(opts.pluginDir)];
  const project = defaultProjectPluginsDir(ctx);
  const user = defaultUserPluginsDir(ctx);
  return opts.scope === 'global' ? [user] : [project, user];
}

/**
 * Build the layered settings.json + DB enabled-resolver. Mirrors the
 * shape of `buildResolver` in `src/cli/commands/plugins.ts` (Step 6.6)
 * to keep the resolution policy in lock-step. Any divergence between
 * `sm plugins list` and the runtime would be a confusing UX regression.
 */
async function buildEnabledResolver(
  scope: 'project' | 'global',
  ctx: IRuntimeContext,
): Promise<(id: string) => boolean> {
  const { effective: cfg } = loadConfig({ scope, ...ctx });
  const dbPath = resolveDbPath({
    global: scope === 'global',
    db: undefined,
    ...ctx,
  });
  const dbOverrides =
    (await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      (adapter) => adapter.pluginConfig.loadOverrideMap(),
    )) ?? new Map<string, boolean>();
  return makeEnabledResolver(cfg, dbOverrides);
}

/**
 * Drop a plugin's loaded extensions into the per-kind buckets. Each
 * `ext.instance` arrives from the loader already cloned with
 * `pluginId` injected (spec § A.6), so this function never mutates.
 *
 * Shares the dispatch table with `built-in-plugins/built-ins.ts:
 * bucketBuiltIn` via `bucketByKind`. Actions are intentionally NOT
 * passed a destination array — they dispatch via the job subsystem
 * (Step 10), not the scan pipeline. The manifest row still records
 * regardless of kind so `sm plugins list` / `sm actions list` see
 * every extension that loaded.
 */
function bucketLoaded(loaded: ILoadedExtension[], bundle: IPluginRuntimeBundle): void {
  for (const ext of loaded) {
    const instance = ext.instance;
    if (!isExtensionInstance(instance)) continue;
    bucketByKind(ext.kind, instance, {
      provider: bundle.extensions.providers,
      extractor: bundle.extensions.extractors,
      analyzer: bundle.extensions.analyzers,
      formatter: bundle.extensions.formatters,
      hook: bundle.extensions.hooks,
      // `action` intentionally absent — see docstring.
    });
    bundle.manifests.push({
      id: ext.id,
      pluginId: ext.pluginId,
      kind: ext.kind,
      version: ext.version,
      ...(ext.entryPath ? { entry: ext.entryPath } : {}),
    });
    // Step 9.6.6 — fold this extension's annotation contributions
    // into the bundle-level catalog. Per-extension shape was already
    // validated at the loader (root requires exclusive; schema must
    // AJV-compile); cross-plugin collision detection happens after
    // every plugin has loaded.
    collectAnnotationContributions(ext.pluginId, instance, bundle.annotationContributions);
    // Step 11.x — same for view contributions. Per-extension shape was
    // already validated at the loader (`contract` against the closed
    // catalog); no cross-plugin collision detection needed because the
    // qualified id `<pluginId>/<extensionId>/<contributionId>` is
    // structurally unique.
    collectViewContributions(ext.pluginId, ext.id, instance, bundle.viewContributions);
  }
}

/**
 * Step 9.6.6 — pluck the optional `annotationContributions` map off a
 * loaded extension instance and append one row per entry to the
 * bundle-level catalog. Defaults are filled in (`location: 'namespaced'`,
 * `ownership: 'shared'`) so consumers downstream see a fully-resolved
 * shape. Built-in catalog fields (from `annotations.schema.json`) are
 * NOT collected here — they are not plugin-contributed.
 */
// Linear collector with one type-guard per nesting level (instance →
// map → entry → schema). Cyclomatic count counts every guard; splitting
// per guard would scatter the path-of-truth without making the code
// clearer.
// eslint-disable-next-line complexity
function collectAnnotationContributions(
  pluginId: string,
  instance: unknown,
  out: IRegisteredAnnotationKey[],
): void {
  if (typeof instance !== 'object' || instance === null) return;
  const raw = (instance as Record<string, unknown>)['annotationContributions'];
  if (typeof raw !== 'object' || raw === null) return;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as Partial<IAnnotationContribution>;
    if (typeof entry.schema !== 'object' || entry.schema === null) continue;
    out.push({
      pluginId,
      key,
      location: entry.location ?? 'namespaced',
      ownership: entry.ownership ?? 'shared',
      schema: entry.schema as Record<string, unknown>,
    });
  }
}

/**
 * Step 11.x — pluck the optional `viewContributions` map off a loaded
 * extension instance and append one row per entry to the bundle-level
 * catalog. Defaults are filled in (`emitWhenEmpty: false`) so consumers
 * downstream see a fully-resolved shape. Built-in extensions opt in
 * the same way as user plugins — there is no "core" privilege.
 *
 * The `slot` value is NOT validated against the closed catalog
 * here; the loader has already done that at AJV time using
 * `view-slots.schema.json#/$defs/IViewContribution`. By the time
 * this collector runs, an extension whose manifest declared an unknown
 * slot is `invalid-manifest` and never reaches `bucketLoaded`.
 */
// eslint-disable-next-line complexity
function collectViewContributions(
  pluginId: string,
  extensionId: string,
  instance: unknown,
  out: IRegisteredViewContribution[],
): void {
  if (typeof instance !== 'object' || instance === null) return;
  const raw = (instance as Record<string, unknown>)['viewContributions'];
  if (typeof raw !== 'object' || raw === null) return;
  for (const [contributionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as Partial<IViewContribution>;
    if (typeof entry.slot !== 'string') continue;
    out.push({
      pluginId,
      extensionId,
      contributionId,
      slot: entry.slot as TSlotName,
      ...(typeof entry.label === 'string' ? { label: entry.label } : {}),
      ...(typeof entry.tooltip === 'string' ? { tooltip: entry.tooltip } : {}),
      ...(typeof entry.icon === 'string' ? { icon: entry.icon } : {}),
      ...(typeof entry.emptyText === 'string' ? { emptyText: entry.emptyText } : {}),
      emitWhenEmpty: entry.emitWhenEmpty === true,
    });
  }
}


function isExtensionInstance(v: unknown): v is { id: string; kind: string; version: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['id'] === 'string' &&
    typeof (v as Record<string, unknown>)['kind'] === 'string' &&
    typeof (v as Record<string, unknown>)['version'] === 'string'
  );
}

// Caps for interpolated values in the warning template. The plugin id
// passes through the loader's regex validator (short, well-shaped) but
// is bounded as defence-in-depth. The reason string is plugin-authored
// (manifest fragments + AJV `instancePath`/`message`, `describe(err)`
// return values) and unbounded — a hostile or buggy plugin could emit
// kilobytes of payload that drown the user's terminal.
const PLUGIN_ID_DISPLAY_CAP = 200;
const PLUGIN_REASON_DISPLAY_CAP = 1000;

/**
 * Render a single-line, scannable diagnostic for a non-loaded plugin.
 * The status name doubles as the failure category so a user can grep
 * `incompatible-spec` / `invalid-manifest` / `load-error` and see the
 * full context. Template lives in `core/runtime/i18n/plugin-runtime.texts.ts`.
 *
 * Both `id` and `reason` flow from plugin-authored sources (manifest
 * fields, AJV error fragments, `describe(err)` payloads). Sanitize +
 * cap before interpolation so a hostile plugin cannot smuggle ANSI
 * control sequences into the user's terminal via its own diagnostic
 * surface.
 *
 * Exported solely for the audit H1 unit tests in
 * `test/plugin-runtime.test.ts` — production callers reach it through
 * `loadPluginRuntime` and write the rendered lines straight to stderr.
 * Renaming or removing the export is a breaking change for the test
 * suite, not for any consumer.
 */
export function formatWarning(plugin: IDiscoveredPlugin): string {
  const rawReason = plugin.reason ?? PLUGIN_RUNTIME_TEXTS.warningReasonMissing;
  return tx(PLUGIN_RUNTIME_TEXTS.warningRow, {
    id: sanitizeForTerminal(truncateHead(plugin.id, PLUGIN_ID_DISPLAY_CAP)),
    status: plugin.status,
    reason: sanitizeForTerminal(truncateHead(rawReason, PLUGIN_REASON_DISPLAY_CAP)),
  });
}
