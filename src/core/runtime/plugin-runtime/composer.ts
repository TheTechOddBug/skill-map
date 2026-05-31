/**
 * Compose helpers that turn a discovered + bucketed plugin runtime into
 * the per-kind shapes the read-side verbs consume.
 *
 *   - `composeScanExtensions`, `IScanExtensions` for the orchestrator
 *     (`sm scan`, `sm watch`, BFF watcher).
 *   - `composeFormatters`, `IFormatter[]` for `sm graph`.
 *   - `registerEnabledExtensions`, Registry update (manifest rows +
 *     annotation / view catalogs).
 *
 * Every helper threads the same `resolveEnabled` (default = runtime's
 * resolver; the BFF / watcher can pass a fresh one to honour a
 * mid-session toggle without restarting `sm serve`).
 */

import {
  collectViewContributions,
  type IProvider,
  type IExtractor,
  type IFormatter,
  type IHook,
  type IAnalyzer,
} from '../../../kernel/extensions/index.js';
import type { IRegisteredAnnotationKey } from '../../../kernel/types/annotation-catalog.js';
import type { IRegisteredViewContribution } from '../../../kernel/types/view-catalog.js';
import type { IExtension } from '../../../kernel/registry.js';
import {
  builtInPlugins,
  listBuiltIns,
} from '../../../plugins/built-ins.js';

import type { IPluginRuntime } from './index.js';
import {
  isBuiltInExtensionEnabled,
  isPluginEntryEnabled,
  isPluginExtensionEnabled,
} from './resolver.js';
import { filterBuiltInManifests } from './catalogs.js';

/**
 * Conformance-only kill-switches (mirrored in the
 * `conformance-case.schema.json#/properties/setup` toggles). Each flag
 * drops every extension of its kind from the scan composer regardless
 * of per-extension toggles and `--no-built-ins`. Production callers MUST
 * NOT set these, they exist so the conformance runner can drive the
 * `kernel-empty-boot` invariant (and any future case that needs an
 * isolated kind) without depending on fixture content being empty.
 *
 * Conformance is invoked as a child `sm scan` process with
 * `SKILL_MAP_DISABLE_ALL_{PROVIDERS,EXTRACTORS,RULES}=1` env vars. The
 * CLI adapter (`cli/util/conformance-env.ts: readConformanceKillSwitches`)
 * reads those env vars at the process boundary and threads the
 * resolved booleans here. The composer itself stays
 * environment-agnostic, keeping `core/` free of `process.env` reads
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
 * fold in, even under `--no-built-ins`, the user wants a stripped-down
 * pipeline of "just my plugins" in that combo. To get a fully empty
 * pipeline (kernel-empty-boot) the caller passes both `--no-built-ins`
 * AND `--no-plugins`.
 *
 * Built-ins are also gated by `pluginRuntime.resolveEnabled`: every
 * extension is independently toggle-able by its qualified id
 * `<plugin>/<ext>` (e.g. disabling `claude/at-directive` silences just
 * that extractor; disabling `core/node-superseded` drops just that
 * analyzer). The plugin row is presentational grouping only.
 * `--no-built-ins` is the macro override that wins when both layers say
 * "skip".
 *
 * `killSwitches` (optional, conformance-only) wins over every other
 * gate, when set, drops every extension of the chosen kind from the
 * composed set, including user plugins. Production callers leave
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
  pluginRuntime: IPluginRuntime;
  /**
   * Optional override that wins over `pluginRuntime.resolveEnabled`.
   * The BFF and the watcher pass a fresh resolver built from
   * `config_plugins` so a toggle made mid-session is honoured without
   * restarting `sm serve`. CLI offline callers (`sm scan`) omit the
   * override and inherit the loader-time resolver (the runtime is
   * loaded fresh per CLI invocation anyway). See
   * `core/runtime/fresh-resolver.ts`.
   *
   * Note on the `startsAsDisabled` exception: drop-in plugins whose
   * discovery-time `status === 'disabled'` are NOT in
   * `pluginRuntime.extensions.*` (see `bucketLoaded` skip-list). The
   * filter below is a no-op for them either way; the spec carries
   * the exception explicitly so the SPA can surface a per-row hint.
   */
  resolveEnabled?: (id: string) => boolean;
  killSwitches?: IConformanceKillSwitches;
}): {
  providers: IProvider[];
  extractors: IExtractor[];
  analyzers: IAnalyzer[];
  hooks: IHook[];
} | undefined {
  const resolveEnabled = opts.resolveEnabled ?? opts.pluginRuntime.resolveEnabled;

  const providers: IProvider[] = [];
  const extractors: IExtractor[] = [];
  const analyzers: IAnalyzer[] = [];
  const hooks: IHook[] = [];

  if (!opts.noBuiltIns) {
    accumulateBuiltInScanExtensions(
      { providers, extractors, analyzers, hooks },
      resolveEnabled,
    );
  }
  // User-plugin extensions: gated by the same resolver so a fresh
  // toggle silences an already-loaded plugin without a restart. Walk
  // each kind once instead of `push(...src)` so we can branch per
  // extension on the resolver verdict.
  for (const ext of opts.pluginRuntime.extensions.providers) {
    if (isPluginExtensionEnabled(ext, resolveEnabled)) providers.push(ext);
  }
  for (const ext of opts.pluginRuntime.extensions.extractors) {
    if (isPluginExtensionEnabled(ext, resolveEnabled)) extractors.push(ext);
  }
  for (const ext of opts.pluginRuntime.extensions.analyzers) {
    if (isPluginExtensionEnabled(ext, resolveEnabled)) analyzers.push(ext);
  }
  for (const ext of opts.pluginRuntime.extensions.hooks) {
    if (isPluginExtensionEnabled(ext, resolveEnabled)) hooks.push(ext);
  }

  // Conformance kill-switches. Applied last so they trump every other
  // gate (per-extension toggles, --no-built-ins, plugin enable/disable).
  const finalProviders = opts.killSwitches?.providers === true ? [] : providers;
  const finalExtractors = opts.killSwitches?.extractors === true ? [] : extractors;
  const finalAnalyzers = opts.killSwitches?.analyzers === true ? [] : analyzers;

  // `kernel-empty-boot` invariant (spec § Boot invariant): zero
  // Providers + Extractors + Analyzers → return `undefined` so the
  // orchestrator follows its zero-extension code path. Hooks are
  // intentionally excluded from this check: a hook that subscribes
  // ONLY to CLI-driven triggers (`boot`, `shutdown`) reaches this
  // composer through the built-in plugins but the scan dispatcher
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
 * Walk every built-in plugin, drop disabled extensions per the
 * resolver, and bucket the survivors into the per-kind arrays.
 * Formatters are consumed by `composeFormatters`, not scan, so they
 * are skipped here even if the plugin ships them.
 */
// Discriminated-union dispatcher, one branch per `ext.kind` plus the
// disabled-guard up front. Cyclomatic count comes from the six-kind
// switch + the per-plugin iteration; splitting per kind would scatter
// the dispatch table without making the algorithm clearer.
// eslint-disable-next-line complexity
export function accumulateBuiltInScanExtensions(
  buckets: { providers: IProvider[]; extractors: IExtractor[]; analyzers: IAnalyzer[]; hooks: IHook[] },
  resolveEnabled: (id: string) => boolean,
): void {
  for (const plugin of builtInPlugins) {
    for (const ext of plugin.extensions) {
      if (!isBuiltInExtensionEnabled(plugin, ext, resolveEnabled)) continue;
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
 * `sm graph`). Built-ins layer first, plugin formatters after, first
 * registration wins on a `formatId` collision, which keeps the kernel's
 * defaults predictable when a plugin claims an existing format. Built-in
 * formatters use the same per-extension resolver as scan-side built-ins.
 */
// Two nested for-loops plus the kind/enabled guards push past the
// default cyclomatic cap. Splitting them would scatter the dispatch
// table without making the algorithm clearer (mirrors the historical
// rationale on `composeScanExtensions`).
// eslint-disable-next-line complexity
export function composeFormatters(opts: {
  noBuiltIns?: boolean;
  pluginRuntime: IPluginRuntime;
  /**
   * Optional resolver override (same semantics as in
   * `composeScanExtensions`). Allows the BFF / watcher to honour a
   * mid-session toggle for formatter-kind extensions without
   * restarting the process.
   */
  resolveEnabled?: (id: string) => boolean;
}): IFormatter[] {
  const noBuiltIns = opts.noBuiltIns ?? false;
  const resolveEnabled = opts.resolveEnabled ?? opts.pluginRuntime.resolveEnabled;
  const out: IFormatter[] = [];
  if (!noBuiltIns) {
    for (const plugin of builtInPlugins) {
      for (const ext of plugin.extensions) {
        if (ext.kind !== 'formatter') continue;
        if (!isBuiltInExtensionEnabled(plugin, ext, resolveEnabled)) continue;
        out.push(ext);
      }
    }
  }
  for (const ext of opts.pluginRuntime.extensions.formatters) {
    if (isPluginExtensionEnabled(ext, resolveEnabled)) out.push(ext);
  }
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
 * Drift was inevitable (a future built-in toggle tweak would have to
 * land on five files at once). The helper consolidates the dance so a
 * single edit moves every consumer in lock-step.
 */
// Complexity counts the per-plugin / per-extension nested walks for
// the built-in catalog merge plus the dual `setRegistered*` guards.
// Splitting the merge body into a private helper would scatter the
// path-of-truth without making the algorithm clearer.
// eslint-disable-next-line complexity
export function registerEnabledExtensions(
  kernel: {
    registry: { register: (m: IExtension) => void };
    setRegisteredAnnotationKeys?: (entries: readonly IRegisteredAnnotationKey[]) => void;
    setRegisteredViewContributions?: (entries: readonly IRegisteredViewContribution[]) => void;
  },
  pluginRuntime: IPluginRuntime,
  options: {
    noBuiltIns?: boolean;
    /**
     * Optional resolver override (same semantics as in
     * `composeScanExtensions`). When threaded by the BFF / watcher,
     * a mid-session toggle filters the matching plugin's manifest +
     * view contributions out of the registry update without a process
     * restart.
     */
    resolveEnabled?: (id: string) => boolean;
  } = {},
): void {
  const noBuiltIns = options.noBuiltIns === true;
  const resolveEnabled = options.resolveEnabled ?? pluginRuntime.resolveEnabled;
  if (!noBuiltIns) {
    const enabledBuiltIns = filterBuiltInManifests(listBuiltIns(), resolveEnabled);
    for (const manifest of enabledBuiltIns) kernel.registry.register(manifest);
  }
  // User-plugin manifests: gate by the resolver so a toggled-off
  // plugin disappears from `sm help` / kindRegistry in the same
  // session. The discovery-time bucketing already excluded plugins
  // that started as `disabled`; this filter catches mid-session
  // toggles of plugins that started enabled.
  for (const manifest of pluginRuntime.manifests) {
    if (!isPluginExtensionEnabled(manifest, resolveEnabled)) continue;
    kernel.registry.register(manifest);
  }
  // Step 9.6.6, publish the runtime catalog so verbs that need
  // autocomplete data (BFF endpoint in the next sub-step, future
  // `sm annotations list`) can read it without re-walking the plugin
  // surface. Optional chaining tolerates legacy callers (tests, hosts
  // that build a kernel-shaped object by hand).
  //
  // Annotation contributions are keyed on `pluginId` only (the catalog
  // row never names a specific extension), so we resolve against the
  // qualified id of the manifest itself by checking each contribution's
  // plugin has at least one enabled extension. Cheap proxy: resolve the
  // pluginId verbatim, callers persist plugin-id toggles for backwards
  // compat with the previous plugin-level kill-switch shape.
  if (kernel.setRegisteredAnnotationKeys) {
    const filteredAnnotations = pluginRuntime.annotationContributions.filter((entry) =>
      resolveEnabled(entry.pluginId),
    );
    kernel.setRegisteredAnnotationKeys(filteredAnnotations);
  }
  // Step 11.x, same publish for view contributions. Optional chaining
  // tolerates legacy callers (tests, kernels created before the field
  // was added).
  //
  // Built-ins fold in here too: `pluginRuntime.viewContributions` is
  // collected only from USER plugins (via `bucketLoaded`); built-in
  // plugins never traverse `bucketLoaded`, so their declared
  // `viewContributions` would otherwise be invisible to the kernel
  // catalog. Walk the enabled built-in extension instances and merge.
  if (kernel.setRegisteredViewContributions) {
    const userContribs = pluginRuntime.viewContributions.filter((entry) =>
      isPluginExtensionEnabled(
        { pluginId: entry.pluginId, id: entry.extensionId },
        resolveEnabled,
      ),
    );
    const merged: IRegisteredViewContribution[] = [...userContribs];
    if (!noBuiltIns) {
      for (const plugin of builtInPlugins) {
        for (const ext of plugin.extensions) {
          if (!isPluginEntryEnabled(plugin, ext.id, resolveEnabled)) continue;
          collectViewContributions(ext.pluginId, ext.id, ext, merged);
        }
      }
    }
    kernel.setRegisteredViewContributions(merged);
  }
}
