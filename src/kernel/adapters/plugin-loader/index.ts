/**
 * `PluginLoader`, default `PluginLoaderPort` implementation.
 *
 * Responsibilities (per spec §Plugin discovery + spec v0.8.0 § A.5,
 * id uniqueness):
 *
 * 1. Discover plugin directories under one or more search paths, each
 *    containing a `plugin.json` at its root.
 * 2. Parse + AJV-validate the manifest against
 *    `plugins-registry.schema.json#/$defs/PluginManifest`.
 * 3. Enforce the structural rule **directory name == manifest id**. A
 *    mismatch surfaces as `invalid-manifest` with a directed reason.
 *    This rule alone rules out same-root collisions by construction
 *    (a filesystem cannot host two siblings with the same name).
 * 4. Semver-check `manifest.specCompat` against the installed
 *    `@skill-map/spec` version.
 * 5. Auto-discover extension files by walking
 *    `<plugin-dir>/<kind>s/<name>/index.{js,mjs,ts}` for each known kind
 *    (`providers`, `extractors`, `analyzers`, `actions`, `formatters`,
 *    `hooks`). Dynamic-import every discovered file, expect a default
 *    export matching the extension-kind schema, validate it, and collect
 *    the loaded extensions. The kind subfolder's name MUST match the
 *    `kind` field on the exported manifest; a mismatch surfaces as
 *    `invalid-manifest` (e.g. an extractor whose source lives under
 *    `analyzers/`).
 * 6. After every plugin has been loaded individually, scan the result set
 *    for cross-root id collisions. Two plugins claiming the same id (any
 *    combination of project + global + `--plugin-dir`) BOTH receive
 *    status `id-collision`; no precedence rule applies. The user resolves
 *    by renaming one and rerunning.
 * 7. Surface one of the documented failure modes when anything fails:
 *    `invalid-manifest` / `incompatible-spec` / `load-error` /
 *    `id-collision`. The kernel keeps booting regardless, a bad plugin
 *    cannot take the process down.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import semver from 'semver';

import type {
  IDiscoveredPlugin,
  IExtensionJsonMeta,
  ILoadedExtension,
  IPluginManifest,
  IUnloadedExtension,
  TUnloadedReason,
} from '../../types/plugin.js';
import type { TExtensionStability } from '../../extensions/base.js';
import type { PluginLoaderPort } from '../../ports/plugin-loader.js';
import { PLUGIN_LOADER_TEXTS, SPEC_GITHUB_BASE } from '../../i18n/plugin-loader.texts.js';
import { tx } from '../../util/tx.js';
import { qualifiedExtensionId, type ExtensionKind } from '../../registry.js';
import {
  installedDefaultEnabled,
  type TEnabledResolver,
} from '../../config/plugin-resolver.js';
import { formatAjvErrors, type ISchemaValidators } from '../schema-validators.js';

import {
  applyIdCollisions,
  describe,
  fail,
  isInsidePlugin,
  isRecord,
  pathId,
} from './id-utils.js';
import {
  extractDefault,
  importWithTimeout,
  stripActivityRuntimeFields,
  stripFunctionsAndPluginId,
} from './import-helpers.js';
import {
  KNOWN_KINDS,
  KNOWN_KINDS_LIST,
  discoverProviderKinds,
  validateActionFileConventions,
  validateAnalyzerFileConventions,
  validateAnnotationContributions,
  validateHookTriggers,
} from './validation.js';
import type { IDiscoveredProviderKind } from './validation.js';
import { loadStorageSchemas } from './storage-schemas.js';

/**
 * Default per-extension dynamic-import timeout. Generous on purpose,
 * a plugin that legitimately takes >5s to import is misbehaving (it
 * should not have heavy work at module top level), but the extra
 * headroom avoids spurious timeouts on cold disk caches and slow CI
 * runners.
 */
export const DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS = 5000;

export interface IPluginLoaderOptions {
  /** Search paths to scan for plugin directories. Non-existent paths are skipped. */
  searchPaths: string[];
  /** Required, used to validate plugin.json and each extension manifest. */
  validators: ISchemaValidators;
  /** Installed @skill-map/spec version, used for specCompat check. */
  specVersion: string;
  /**
   * The enable gate, consulted TWICE and at two granularities:
   *
   *   1. With the bare plugin id, after manifest + specCompat validation
   *      succeed. `false` short-circuits the whole plugin to
   *      `status: 'disabled'` with nothing imported.
   *   2. With each QUALIFIED `<plugin>/<ext>` id plus that extension's
   *      installed default (derived from its `extension.json`
   *      `stability` / `defaultEnabled`), immediately before its import.
   *      `false` means the module is never evaluated and the extension
   *      is reported in `unloadedExtensions`.
   *
   * Pass 2 is why this is the full `TEnabledResolver` and not the
   * narrower `(id) => boolean` it used to be: the installed default has
   * to reach the resolver. A separate per-extension option was rejected
   * on purpose, two enable policies would drift and the resolver layer
   * exists precisely to prevent that.
   *
   * Omitted (tests asserting raw discovery, no config integration) means
   * each extension falls back to its own installed default, so an
   * `experimental` extension still ships disabled.
   */
  resolveEnabled?: TEnabledResolver;
  /**
   * Import-trust gate (security boundary). When supplied, the loader
   * calls this with every parsed plugin id AFTER manifest + specCompat
   * validation but BEFORE importing any extension entry. A return value
   * of `false` short-circuits the load WITHOUT executing plugin code:
   * the plugin is reported with `status: 'disabled'` + `untrusted: true`
   * and a directed reason, so `sm plugins list` still surfaces it.
   *
   * This is distinct from `resolveEnabled` (the per-config enable gate):
   * trust answers "may this disk code run at all?" and is driven ONLY by
   * a LOCAL signal (the scope lock), never the committed
   * `settings.json` baseline, since a cloned repo controls the latter.
   * The runtime passes this for project-local discovery so `sm scan` /
   * `sm serve` never auto-execute a cloned repo's plugins; the
   * `sm plugins` management family and explicit `--plugin-dir` omit it.
   * Omitted == "trust everything" (built-ins, tests, explicit dirs).
   */
  resolveImportTrust?: (pluginId: string) => boolean;
  /**
   * Per-extension dynamic-import timeout in milliseconds. A plugin whose
   * top-level work (imports, side effects) exceeds this is reported as
   * `load-error` with a message naming the timeout, instead of hanging
   * the host CLI command (`sm scan`, `sm plugins list`, `sm watch`).
   * Defaults to `DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS` (5s). Tests pass a
   * smaller value to exercise the timeout path quickly.
   *
   * Note: there is no AbortSignal on `import()` in Node 24, when the
   * timer wins, the import is abandoned (the dangling promise resolves
   * later and is GC'd) but its side effects, if any, still run. The
   * timeout protects the orchestrator from hanging, not the host
   * process from a misbehaving plugin's runtime cost.
   */
  loadTimeoutMs?: number;
}

/**
 * Factory, preferred entry point for production callers (CLI). Returns
 * the port shape so the consumer is pinned to the abstract contract,
 * not the concrete class. Tests that need to access internals continue
 * to use `new PluginLoader(...)` directly.
 */
export function createPluginLoader(options: IPluginLoaderOptions): PluginLoaderPort {
  return new PluginLoader(options);
}

export class PluginLoader implements PluginLoaderPort {
  readonly #options: IPluginLoaderOptions;
  readonly #loadTimeoutMs: number;

  constructor(options: IPluginLoaderOptions) {
    this.#options = options;
    this.#loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS;
  }

  /**
   * Discover every plugin directory across the configured search paths.
   * Each direct child directory containing a `plugin.json` is considered a
   * plugin root. Non-plugin directories are silently skipped.
   */
  discoverPaths(): string[] {
    const out: string[] = [];
    for (const root of this.#options.searchPaths) {
      if (!existsSync(root)) continue;
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = join(root, entry.name);
        if (existsSync(join(candidate, 'plugin.json'))) {
          out.push(resolve(candidate));
        }
      }
    }
    return out;
  }

  /**
   * Full pass, discover every plugin, attempt to load each, then apply
   * the cross-root id-collision pass over the results. Two plugins that
   * survived their individual load with the same `pluginId` both get
   * downgraded to status `id-collision` (no precedence, the spec is
   * explicit that "no extension is privileged"). Plugins that already
   * failed their individual load (`invalid-manifest` /
   * `incompatible-spec` / `load-error`) keep their original status:
   * their `id` field is untrusted (it may be a fall-back path hint when
   * the manifest could not be parsed) and they would muddy the
   * collision report.
   */
  async discoverAndLoadAll(): Promise<IDiscoveredPlugin[]> {
    const paths = this.discoverPaths();
    const out: IDiscoveredPlugin[] = [];
    for (const path of paths) {
      out.push(await this.loadOne(path));
    }
    return applyIdCollisions(out);
  }

  /**
   * Load a single plugin from its directory. Never throws, a failure is
   * reported via the returned status.
   *
   * Cyclomatic count covers the four sequential phases (manifest parse,
   * enabled resolution, per-extension load loop, storage output-schemas
   * compile) plus their failure short-circuits. Splitting each phase
   * into a helper would scatter the return-on-failure pattern without
   * making the orchestration clearer.
   */
  async loadOne(pluginPath: string): Promise<IDiscoveredPlugin> {
    // Structure-as-truth: the plugin id IS the directory name. The
    // manifest no longer carries the field; AJV rejects manifests that
    // declare an `id` literal via `additionalProperties: false`.
    const pluginId = pathId(pluginPath);

    const manifestResult = this.#parseAndValidateManifest(pluginPath, pluginId);
    if (!manifestResult.ok) return manifestResult.failure;
    const manifest = manifestResult.manifest;

    // --- pre-import gates: enable resolution + import trust ---------------
    const gated = this.#preImportGate(pluginPath, pluginId, manifest);
    if (gated) return gated;

    // --- extension imports + kind validation ------------------------------
    const entries = await this.#loadExtensions(pluginPath, pluginId, manifest);
    if (!entries.ok) return entries.failure;
    const { loaded, unloaded } = entries;

    // --- storage output schemas (spec § A.12) -----------------------------
    const storageSchemasResult = loadStorageSchemas(pluginPath, pluginId, manifest);
    if (!storageSchemasResult.ok) {
      return {
        ...fail(pluginPath, pluginId, 'load-error', storageSchemasResult.reason),
        manifest,
      };
    }

    return {
      path: pluginPath,
      id: pluginId,
      status: 'enabled',
      manifest,
      extensions: loaded,
      // Status stays `enabled` even when every extension was skipped:
      // it describes the PLUGIN's outcome (parsed, trusted, enabled).
      // The per-extension truth is the split between the two arrays.
      ...(unloaded.length > 0 ? { unloadedExtensions: unloaded } : {}),
      ...(storageSchemasResult.schemas
        ? { storageSchemas: storageSchemasResult.schemas }
        : {}),
    };
  }

  /**
   * Pre-import gates run AFTER the JSON manifest parse (safe) and BEFORE
   * any extension `import()` (executes code). Returns a short-circuit
   * `disabled` discovery (manifest kept, code NOT imported) when a gate
   * refuses, or `null` to proceed to the import loop:
   *
   *   - enable resolution: the per-config `resolveEnabled` plugin gate.
   *   - import trust: the security boundary, refuse to execute a
   *     project-local plugin the operator has not locally trusted; the
   *     plugin stays discoverable in `sm plugins list` without running.
   */
  #preImportGate(
    pluginPath: string,
    pluginId: string,
    manifest: IPluginManifest,
  ): IDiscoveredPlugin | null {
    if (this.#options.resolveEnabled && !this.#options.resolveEnabled(pluginId)) {
      return {
        path: pluginPath,
        id: pluginId,
        status: 'disabled',
        manifest,
        unloadedExtensions: this.#inventory(pluginPath, pluginId, 'plugin-disabled'),
        reason: PLUGIN_LOADER_TEXTS.disabledByConfig,
      };
    }
    if (this.#options.resolveImportTrust && !this.#options.resolveImportTrust(pluginId)) {
      return {
        path: pluginPath,
        id: pluginId,
        status: 'disabled',
        untrusted: true,
        manifest,
        unloadedExtensions: this.#inventory(pluginPath, pluginId, 'plugin-untrusted'),
        reason: tx(PLUGIN_LOADER_TEXTS.untrustedNotLoaded, { pluginId }),
      };
    }
    return null;
  }

  /**
   * Walk every discovered entry and split it three ways: loaded (its
   * code ran), skipped (disabled, so its code did NOT run), or a failure
   * that sinks the whole plugin.
   *
   * The two success arms stay in separate arrays because only `loaded`
   * is ever handed to the registry / composer, which is what makes
   * "disabled code never runs" structural instead of a convention.
   */
  async #loadExtensions(
    pluginPath: string,
    pluginId: string,
    manifest: IPluginManifest,
  ): Promise<
    | { ok: true; loaded: ILoadedExtension[]; unloaded: IUnloadedExtension[] }
    | { ok: false; failure: IDiscoveredPlugin }
  > {
    const loaded: ILoadedExtension[] = [];
    const unloaded: IUnloadedExtension[] = [];
    for (const relEntry of discoverExtensionEntries(pluginPath)) {
      const result = await this.#loadAndValidateExtensionEntry(pluginPath, pluginId, manifest, relEntry);
      if (!result.ok) return result;
      if ('skipped' in result) unloaded.push(result.skipped);
      else loaded.push(result.extension);
    }
    return { ok: true, loaded, unloaded };
  }

  /**
   * The plugin's declared extension inventory, read from disk with ZERO
   * code execution, for a plugin the gate just refused.
   *
   * This is what makes "review before you trust" actually reviewable:
   * the operator sees which extensions a project-local plugin ships, of
   * which kinds and versions, without any of it running. Reading the
   * source is still the real review; this is the index to it.
   *
   * Best-effort by design. An entry whose `extension.json` is missing or
   * unreadable is skipped silently rather than failing the plugin: full
   * validation belongs to the load path, and a refused plugin never
   * reaches it. Erroring here would turn a listing into a gate.
   */
  #inventory(
    pluginPath: string,
    pluginId: string,
    reason: TUnloadedReason,
  ): IUnloadedExtension[] {
    const out: IUnloadedExtension[] = [];
    for (const relEntry of discoverExtensionEntries(pluginPath)) {
      const parsed = this.#readExtensionManifest(pluginPath, relEntry);
      if (!parsed.ok) continue;
      const [kindDir, id] = relEntry.split('/');
      const kind = kindDir?.endsWith('s') ? (kindDir.slice(0, -1) as ExtensionKind) : undefined;
      if (!kind || !KNOWN_KINDS.has(kind) || !id) continue;
      out.push(unloadedRow(parsed.meta, { kind, id, pluginId, entryPath: resolve(pluginPath, relEntry), reason }));
    }
    return out;
  }

  /**
   * Read + AJV-validate `<ext-dir>/extension.json`.
   *
   * Pure disk I/O and JSON parsing; nothing here executes plugin code,
   * which is the entire reason the file exists. Callers decide whether a
   * failure is fatal (the load path) or skippable (the inventory above).
   */
  #readExtensionManifest(
    pluginPath: string,
    relEntry: string,
  ): { ok: true; meta: IExtensionJsonMeta } | { ok: false; reason: string } {
    const path = resolve(pluginPath, dirname(relEntry), EXTENSION_MANIFEST_FILE);
    if (!existsSync(path)) {
      return {
        ok: false,
        reason: tx(PLUGIN_LOADER_TEXTS.invalidManifestExtensionJsonMissing, { relEntry }),
      };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      return {
        ok: false,
        reason: tx(PLUGIN_LOADER_TEXTS.invalidManifestExtensionJsonParse, {
          relEntry,
          errDescription: describe(err),
        }),
      };
    }
    const validated = this.#options.validators.validate<IExtensionJsonMeta>('extension-manifest', raw);
    if (!validated.ok) {
      return {
        ok: false,
        reason: tx(PLUGIN_LOADER_TEXTS.invalidManifestExtensionJsonInvalid, {
          relEntry,
          errors: validated.errors,
        }),
      };
    }
    return { ok: true, meta: validated.data };
  }

  /**
   * Phase 1 of `loadOne`, read `plugin.json`, AJV-validate the manifest,
   * enforce the directory-name == pluginId structural rule, and check
   * specCompat (range syntax + satisfies the installed spec version).
   * Returns either the validated manifest or an `IDiscoveredPlugin` with
   * the appropriate failure status.
   */
  #parseAndValidateManifest(
    pluginPath: string,
    pluginId: string,
  ): { ok: true; manifest: IPluginManifest } | { ok: false; failure: IDiscoveredPlugin } {
    const manifestPath = join(pluginPath, 'plugin.json');

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      return { ok: false, failure: fail(
        pluginPath,
        pluginId,
        'invalid-manifest',
        tx(PLUGIN_LOADER_TEXTS.invalidManifestJsonParse, {
          manifestPath,
          errDescription: describe(err),
        }),
      )};
    }

    const manifestResult = this.#options.validators.validatePluginManifest<IPluginManifest>(raw);
    if (!manifestResult.ok) {
      return { ok: false, failure: fail(
        pluginPath,
        pluginId,
        'invalid-manifest',
        tx(PLUGIN_LOADER_TEXTS.invalidManifestAjv, {
          manifestPath,
          errors: manifestResult.errors,
        }),
      )};
    }
    const manifest = manifestResult.data;

    // Structure-as-truth: the dir-name == pluginId structural check is
    // gone; the plugin id IS the directory name and AJV
    // (`additionalProperties: false`) rejects manifests that try to
    // declare the field.

    if (!semver.validRange(manifest.specCompat)) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          pluginId,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidSpecCompat, { specCompat: manifest.specCompat }),
        ),
        manifest,
      }};
    }
    if (!semver.satisfies(this.#options.specVersion, manifest.specCompat, { includePrerelease: true })) {
      return { ok: false, failure: {
        path: pluginPath,
        id: pluginId,
        status: 'incompatible-spec',
        manifest,
        reason: tx(PLUGIN_LOADER_TEXTS.incompatibleSpec, {
          installedSpecVersion: this.#options.specVersion,
          specCompat: manifest.specCompat,
        }),
      }};
    }

    return { ok: true, manifest };
  }

  /**
   * Phase 3 of `loadOne`, load and validate one extension entry. Six
   * sub-checks (file exists, dynamic import, has kind, kind known,
   * pluginId match, kind-specific manifest validation including hook
   * trigger pre-check). On success returns the `ILoadedExtension` with
   * `pluginId` injected; on failure returns the `IDiscoveredPlugin`
   * with the appropriate status (`load-error` or `invalid-manifest`).
   */
  // Six sub-validations per extension entry (file exists, dynamic
  // import, has-kind, kind-known, pluginId match, kind-specific schema
  // including hook trigger pre-check). Each branch is one early-return;
  // splitting per sub-check would multiply the discriminated-union
  // boilerplate without making the validation pipeline clearer.
  // eslint-disable-next-line complexity
  async #loadAndValidateExtensionEntry(
    pluginPath: string,
    pluginId: string,
    manifest: IPluginManifest,
    relEntry: string,
  ): Promise<
    | { ok: true; extension: ILoadedExtension }
    | { ok: true; skipped: IUnloadedExtension }
    | { ok: false; failure: IDiscoveredPlugin }
  > {
    if (!isInsidePlugin(pluginPath, relEntry)) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          pluginId,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.loadErrorPathEscapesPlugin, { relEntry, pluginPath }),
        ),
        manifest,
      }};
    }
    const abs = resolve(pluginPath, relEntry);
    if (!existsSync(abs)) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          pluginId,
          'load-error',
          tx(PLUGIN_LOADER_TEXTS.loadErrorFileNotFound, { relEntry, abs }),
        ),
        manifest,
      }};
    }

    // --- everything below this line runs BEFORE any code executes -------
    //
    // Structure-as-truth: kind and id come from the path segment, not
    // from manifest fields. The path layout is
    // `<kind-plural>/<id>/index.<ext>`; the parent directory dictates
    // `kind`, the leaf directory dictates `id`. This derivation used to
    // sit after the import (it needed nothing from the module even
    // then); it has to precede it now, because the qualified id is what
    // the enable gate keys on.
    const derived = deriveEntryIdentity(relEntry);
    if (!derived.ok) {
      return { ok: false, failure: {
        ...fail(pluginPath, pluginId, 'invalid-manifest', derived.reason),
        manifest,
      }};
    }
    const { kind, id: pathId } = derived;

    const parsedMeta = this.#readExtensionManifest(pluginPath, relEntry);
    if (!parsedMeta.ok) {
      return { ok: false, failure: {
        ...fail(pluginPath, pluginId, 'invalid-manifest', parsedMeta.reason),
        manifest,
      }};
    }
    const meta = parsedMeta.meta;

    // THE GATE. An extension the operator disabled, or one that ships
    // disabled because it is `experimental` / `deprecated`, stops here:
    // its module body is never evaluated. This is only expressible
    // because `stability` / `defaultEnabled` live on disk; while they
    // lived in the export, answering "may this run?" required running
    // it. `resolveEnabled` is consulted with the QUALIFIED id, unlike
    // the plugin-level gate which passes the bare plugin id.
    const installedDefault = installedDefaultEnabled(meta.stability, meta.defaultEnabled);
    const enabled = this.#options.resolveEnabled
      ? this.#options.resolveEnabled(qualifiedExtensionId(pluginId, pathId), installedDefault)
      : installedDefault;
    if (!enabled) {
      return { ok: true, skipped: unloadedRow(meta, {
        kind,
        id: pathId,
        pluginId,
        entryPath: abs,
        reason: 'extension-disabled',
      }) };
    }

    let mod: unknown;
    try {
      mod = await importWithTimeout(pathToFileURL(abs).href, this.#loadTimeoutMs);
    } catch (err) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          pluginId,
          'load-error',
          tx(PLUGIN_LOADER_TEXTS.loadErrorImportFailed, {
            relEntry,
            errDescription: describe(err),
          }),
        ),
        manifest,
      }};
    }

    const exported = extractDefault(mod);
    if (!isRecord(exported)) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          pluginId,
          'load-error',
          tx(PLUGIN_LOADER_TEXTS.loadErrorMissingKind, {
            relEntry,
            knownKindsList: KNOWN_KINDS_LIST,
          }),
        ),
        manifest,
      }};
    }

    // `pluginId` is injected from `plugin.json#/id` (spec § A.6). A
    // declared value that disagrees is an author bug, reject it; a value
    // that matches is tolerated and stripped before AJV (see the strict
    // guard below for `id` / `kind` / `kinds` / `formatId`, which are
    // never tolerated).
    const declaredPluginId = exported['pluginId'];
    if (typeof declaredPluginId === 'string' && declaredPluginId !== pluginId) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          pluginId,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.loadErrorPluginIdMismatch, {
            relEntry,
            declared: declaredPluginId,
            manifestId: pluginId,
          }),
        ),
        manifest,
      }};
    }

    // Strict structure-as-truth: `id` / `kind` / `kinds` / `formatId` are
    // derived from the folder layout (`<plugin>/<kind>s/<name>/`, plus the
    // Provider `kinds/` catalog and the formatter folder name), never
    // declared. A manifest that re-declares any of them, even with a
    // matching value, is rejected: a second source of truth can silently
    // drift from the path, so the loader surfaces it at load instead of
    // stripping it away.
    const redeclared = DERIVED_MANIFEST_KEYS.filter((field) => field in exported);
    if (redeclared.length > 0) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          pluginId,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidManifestRedeclaredField, {
            relEntry,
            fields: redeclared.map((field) => `\`${field}\``).join(', '),
          }),
        ),
        manifest,
      }};
    }

    // The relocated four. AJV would reject them anyway (they are no
    // longer declared in `base.schema.json`, and every kind schema sets
    // `unevaluatedProperties: false`), but a bare "unevaluated property"
    // complaint would not tell an author that the field MOVED, or where.
    const relocated = EXTENSION_JSON_KEYS.filter((field) => field in exported);
    if (relocated.length > 0) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          pluginId,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidManifestExtensionJsonFieldInModule, {
            relEntry,
            fields: relocated.map((field) => `\`${field}\``).join(', '),
          }),
        ),
        manifest,
      }};
    }

    // Strip runtime methods + the injected `pluginId` so AJV's strict
    // `unevaluatedProperties: false` doesn't reject the export. The
    // structure-as-truth fields are gone already (rejected above). For a
    // provider, also drop the `activity` capability's runtime-only fields
    // (`pluginHooksSource` / `mapEvent`): the top-level function strip is
    // shallow, so a nested method or a runtime string inside `activity`
    // survives and would trip the schema's `additionalProperties: false`.
    const manifestView =
      kind === 'provider'
        ? stripActivityRuntimeFields(stripFunctionsAndPluginId(exported))
        : stripFunctionsAndPluginId(exported);

    if (kind === 'hook') {
      const hookFailure = validateHookTriggers(pluginPath, pluginId, manifest, relEntry, exported, manifestView);
      if (hookFailure) return { ok: false, failure: hookFailure };
    }

    // Spec §architecture.md, "AJV at three layers, manifest at load
    // (rejects unknown `slot` names with `invalid-manifest`)". The
    // kind-specific schema validates the exported manifest shape
    // (e.g. `viewContributions[*].slot` against the closed catalog,
    // extractor's required `emitsLinkKinds`, etc.). Failures here are
    // structurally manifest-invalid, not module-load failures, the
    // module imported fine; the declared shape is wrong.
    const extValidator = this.#options.validators.validatorForExtension(kind);
    if (!extValidator(manifestView)) {
      const errors = formatAjvErrors(extValidator.errors);
      // A bad view-slot value points the author at the slot catalog
      // (where the valid slot names live), not the kind schema (which
      // only `$ref`s the catalog). Every other manifest-shape error
      // points at the kind schema. The view-slot field is `ui.<id>.slot`,
      // so its AJV instancePath ends with `/slot`.
      const slotError = (extValidator.errors ?? []).some((e) =>
        (e.instancePath ?? '').endsWith('/slot'),
      );
      const docUrl = slotError
        ? `${SPEC_GITHUB_BASE}/spec/view-slots.md`
        : `${SPEC_GITHUB_BASE}/spec/schemas/extensions/${kind}.schema.json`;
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          pluginId,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidManifestExtensionShape, { relEntry, errors, docUrl }),
        ),
        manifest,
      }};
    }

    // Spec § 9.6.6, per-extension annotation-contribution validation.
    // Two cross-cutting rules per entry: (a) `location: 'root'` REQUIRES
    // `ownership: 'exclusive'`, (b) the inline `schema` must be a valid
    // JSON Schema (compile with AJV). Cross-plugin collision detection
    // for `(key, location: 'root', ownership: 'exclusive')` runs later
    // at the orchestrator/composer level; this stage covers single-plugin
    // shape validation only.
    const contribFailure = validateAnnotationContributions(
      pluginPath,
      pluginId,
      manifest,
      relEntry,
      manifestView,
    );
    if (contribFailure) return { ok: false, failure: contribFailure };

    // Structure-as-truth: Actions resolve their report schema and
    // (when probabilistic) their prompt template by convention from
    // disk. Validate the convention before the runtime tries to use
    // these files so a misconfigured action surfaces at load.
    if (kind === 'action') {
      const actionFailure = validateActionFileConventions(
        pluginPath,
        pluginId,
        manifest,
        relEntry,
        abs,
        manifestView,
      );
      if (actionFailure) return { ok: false, failure: actionFailure };
    }

    // Structure-as-truth (finder half of the dual-mode Analyzer): a
    // probabilistic Analyzer resolves `prompt.md` + `report.schema.json`
    // by convention, and the report schema MUST extend the canonical
    // findings envelope. Validate at load so a misconfigured finder
    // surfaces as `invalid-manifest` instead of at the first submit.
    if (kind === 'analyzer') {
      const analyzerFailure = validateAnalyzerFileConventions(
        pluginPath,
        pluginId,
        manifest,
        relEntry,
        abs,
        manifestView,
      );
      if (analyzerFailure) return { ok: false, failure: analyzerFailure };
    }

    // Structure-as-truth (Provider): the kinds catalog now lives on disk
    // under `<plugin>/kinds/<kindName>/{schema.json, kind.json}`. The
    // loader discovers it and pre-populates the runtime descriptor so
    // the orchestrator / UI consume one shape regardless of how the
    // Provider's TypeScript source declared its `kinds` field.
    let discoveredKinds: Record<string, IDiscoveredProviderKind> | undefined;
    if (kind === 'provider') {
      const kindsResult = discoverProviderKinds(
        pluginPath,
        pluginId,
        manifest,
        relEntry,
        (data) => {
          const v = this.#options.validators.validate('extension-provider-kind', data);
          if (v.ok) return { ok: true, errors: '' };
          return { ok: false, errors: v.errors };
        },
      );
      if (!kindsResult.ok) return { ok: false, failure: kindsResult.failure };
      if (Object.keys(kindsResult.kinds).length > 0) discoveredKinds = kindsResult.kinds;
    }

    // Shallow-clone the runtime instance + inject `pluginId`, `id`, and
    // `kind` (all derived from the path) so two plugins importing the
    // same ESM-cached file don't stomp each other and the runtime always
    // sees the canonical fields. Formatters additionally get `formatId`
    // mirrored from the folder name so `sm graph --format <name>` keeps
    // its domain-specific lookup field; that mapping is the only place
    // structure-as-truth synthesizes a second runtime alias. Providers get
    // the filesystem-discovered `kinds` catalog injected here; the export
    // can no longer inline a `kinds` map (rejected at load), so there is
    // nothing to merge.
    //
    // The four `extension.json` fields are merged back on here, because
    // downstream code reads them off the live instance in dozens of
    // places (`bucketLoaded` reads `description`, the BFF projects
    // `stability`, ...). Moving the SOURCE of truth to disk must not move
    // the runtime shape. This is a TOP-LEVEL spread of four scalars and
    // must stay that way: `readDeclaredContributionRefs` matches the `ui`
    // object an author hands to `emitContribution` by IDENTITY, so a deep
    // clone here would silently break every view contribution.
    const instance: Record<string, unknown> = {
      ...exported,
      version: meta.version,
      description: meta.description,
      ...(meta.stability !== undefined ? { stability: meta.stability } : {}),
      ...(meta.defaultEnabled !== undefined ? { defaultEnabled: meta.defaultEnabled } : {}),
      pluginId,
      id: pathId,
      kind,
    };
    if (kind === 'formatter') instance['formatId'] = pathId;
    if (kind === 'provider' && discoveredKinds) {
      instance['kinds'] = discoveredKinds;
    }

    return { ok: true, extension: {
      kind,
      id: pathId,
      pluginId,
      version: meta.version,
      description: meta.description,
      ...(meta.stability !== undefined ? { stability: meta.stability } : {}),
      ...(meta.defaultEnabled !== undefined ? { defaultEnabled: meta.defaultEnabled } : {}),
      entryPath: abs,
      module: mod,
      instance,
    }};
  }
}

/**
 * Manifest fields the loader derives from the filesystem layout, never
 * from the export. Declaring any of them is rejected as `invalid-manifest`
 * (strict structure-as-truth): `id` is the leaf folder, `kind` the parent
 * folder, provider `kinds` the `kinds/<kindName>/` catalog, formatter
 * `formatId` the formatter folder name. `pluginId` is NOT here, it has a
 * dedicated mismatch check and a matching value is tolerated.
 */
const DERIVED_MANIFEST_KEYS: readonly string[] = ['id', 'kind', 'kinds', 'formatId'];

/**
 * Fields that moved OUT of the module and into `extension.json`.
 *
 * Kept separate from `DERIVED_MANIFEST_KEYS` because the remedy differs:
 * those are derived from the folder layout and simply deleted, these
 * were relocated and the author has to move them to the sibling file.
 * The two messages say different things for that reason.
 *
 * The kind schemas' `unevaluatedProperties: false` already rejects them
 * (they are no longer declared in `base.schema.json`); this check exists
 * to say WHY, and where they went, instead of a bare AJV complaint.
 */
const EXTENSION_JSON_KEYS: readonly string[] = [
  'version',
  'description',
  'stability',
  'defaultEnabled',
];

/** File name of the per-extension declarative manifest. */
const EXTENSION_MANIFEST_FILE = 'extension.json';

/**
 * Derive `kind` + `id` from the entry's relative path. Pure string work
 * over `<kind-plural>/<id>/index.<ext>`, so it can run before the import
 * and gate on the qualified id without executing anything.
 */
function deriveEntryIdentity(
  relEntry: string,
): { ok: true; kind: ExtensionKind; id: string } | { ok: false; reason: string } {
  const [kindDir, id] = relEntry.split('/');
  const kind = kindDir && kindDir.endsWith('s')
    ? (kindDir.slice(0, -1) as ExtensionKind)
    : undefined;
  if (!kind || !KNOWN_KINDS.has(kind)) {
    return {
      ok: false,
      reason: tx(PLUGIN_LOADER_TEXTS.loadErrorUnknownKind, {
        relEntry,
        kindReceived: String(kindDir ?? '(missing)'),
        knownKindsList: KNOWN_KINDS_LIST,
      }),
    };
  }
  if (!id) {
    return {
      ok: false,
      reason: tx(PLUGIN_LOADER_TEXTS.loadErrorMissingKind, {
        relEntry,
        knownKindsList: KNOWN_KINDS_LIST,
      }),
    };
  }
  return { ok: true, kind, id };
}

/**
 * Build the record for an extension that exists but was not imported.
 * Spreads the optional fields only when declared, so the row never
 * invents a `stability` the author did not write.
 */
function unloadedRow(
  meta: IExtensionJsonMeta,
  identity: {
    kind: ExtensionKind;
    id: string;
    pluginId: string;
    entryPath: string;
    reason: TUnloadedReason;
  },
): IUnloadedExtension {
  return {
    ...identity,
    version: meta.version,
    description: meta.description,
    ...(meta.stability !== undefined ? { stability: meta.stability } : {}),
    ...(meta.defaultEnabled !== undefined ? { defaultEnabled: meta.defaultEnabled } : {}),
  };
}

/**
 * Plural directory name for each extension kind. The path
 * `<plugin-dir>/<plural>/<name>/index.{js,mjs,ts}` is the auto-discovery
 * convention; the directory's kind segment is the source of truth for
 * which kind the loader expects the export to declare.
 */
const KIND_DIR_NAMES: readonly string[] = [
  'providers',
  'extractors',
  'analyzers',
  'actions',
  'formatters',
  'hooks',
];

/**
 * File names checked, in priority order, inside each
 * `<plugin-dir>/<kind>s/<name>/` directory. The first existing match
 * becomes the discovered entry; later candidates are ignored so a
 * `.js` build artifact next to a `.ts` source picks the compiled file
 * deterministically.
 */
const INDEX_CANDIDATES: readonly string[] = [
  'index.js',
  'index.mjs',
  'index.ts',
];

/**
 * Walk a plugin directory and return the relative paths of every
 * discovered extension entry, in the canonical order:
 *
 *   1. Kinds in `KIND_DIR_NAMES` order (providers first, hooks last)
 *      so the snapshot test ordering stays stable across runs.
 *   2. Inside each kind, extension subdirectories sorted alphabetically
 *      for the same determinism reason.
 *
 * Returned paths are relative to `pluginPath` with forward slashes,
 * exactly the shape `#loadAndValidateExtensionEntry` expects.
 *
 * Silently skips:
 *   - Files at the kind-folder root (e.g. `extractors/foo.ts`); only
 *     `<kind>s/<name>/index.*` is honoured.
 *   - Subdirectories without an `index.{js,mjs,ts}` (treated as data,
 *     fixtures, conformance scopes, etc.).
 *   - Dotfiles and TypeScript declaration files (`*.d.ts` never match
 *     `index.{js,mjs,ts}`).
 */
function discoverExtensionEntries(pluginPath: string): string[] {
  const out: string[] = [];
  for (const kindDir of KIND_DIR_NAMES) {
    collectKindEntries(pluginPath, kindDir, out);
  }
  return out;
}

function collectKindEntries(pluginPath: string, kindDir: string, out: string[]): void {
  const kindAbs = resolve(pluginPath, kindDir);
  if (!existsSync(kindAbs)) return;
  let entries: string[];
  try {
    entries = readdirSync(kindAbs);
  } catch {
    return;
  }
  entries.sort();
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const entryAbs = resolve(kindAbs, entry);
    if (!isDirectorySafe(entryAbs)) continue;
    const candidate = findIndexCandidate(entryAbs);
    if (candidate !== null) {
      out.push(`${kindDir}/${entry}/${candidate}`);
    }
  }
}

function isDirectorySafe(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function findIndexCandidate(entryAbs: string): string | null {
  for (const candidate of INDEX_CANDIDATES) {
    if (existsSync(resolve(entryAbs, candidate))) return candidate;
  }
  return null;
}

/**
 * Locate the installed `@skill-map/spec` version at runtime. Handy default
 * for `IPluginLoaderOptions.specVersion` when the caller just wants the
 * real installed version without plumbing it through.
 */
export function installedSpecVersion(): string {
  const require = createRequire(import.meta.url);
  // Spec exports index.json but not package.json; we use the former to
  // locate the package root and then read package.json off disk directly.
  const indexPath = require.resolve('@skill-map/spec/index.json');
  const pkgPath = resolve(indexPath, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}
