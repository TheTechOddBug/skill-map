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
 * 5. Dynamic-import every path listed in `manifest.extensions[]`, expect a
 *    default export matching the extension-kind schema, validate it, and
 *    collect the loaded extensions.
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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import semver from 'semver';

import type {
  IDiscoveredPlugin,
  ILoadedExtension,
  IPluginManifest,
} from '../../types/plugin.js';
import type { PluginLoaderPort } from '../../ports/plugin-loader.js';
import { PLUGIN_LOADER_TEXTS } from '../../i18n/plugin-loader.texts.js';
import { tx } from '../../util/tx.js';
import type { ExtensionKind } from '../../registry.js';
import type { ISchemaValidators } from '../schema-validators.js';

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
  stripFunctionsAndPluginId,
} from './import-helpers.js';
import {
  KNOWN_KINDS,
  KNOWN_KINDS_LIST,
  validateAnnotationContributions,
  validateHookTriggers,
} from './validation.js';
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
   * When supplied, the loader calls this with every parsed plugin id
   * AFTER manifest + specCompat validation succeed. A return value of
   * `false` short-circuits the load: the plugin is reported with
   * `status: 'disabled'` and its extensions are NOT imported. Defaults
   * to "always enabled" when omitted (no DB / config integration,
   * useful for tests that assert raw discovery behaviour).
   */
  resolveEnabled?: (pluginId: string) => boolean;
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
   * survived their individual load with the same `manifest.id` both get
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
   */
  // eslint-disable-next-line complexity
  async loadOne(pluginPath: string): Promise<IDiscoveredPlugin> {
    const manifestResult = this.#parseAndValidateManifest(pluginPath);
    if (!manifestResult.ok) return manifestResult.failure;
    const manifest = manifestResult.manifest;

    // --- enabled resolution ----------------------------------------------
    // Only check after manifest + specCompat pass: a `disabled` status
    // implies "we know this plugin enough to surface it; we just chose
    // not to run it". An invalid or incompatible plugin gets its own
    // status and never reaches this branch.
    //
    // Spec § A.7, granularity. The loader's pre-import resolveEnabled()
    // check uses the plugin id (the bundle-level key). Plugins with
    // granularity='extension' that want to gate individual extensions
    // need a richer policy at the runtime composer (see
    // `cli/util/plugin-runtime.ts`); the loader stage is intentionally
    // coarse, disabling the bundle id always wins, so the import work
    // is skipped wholesale.
    if (this.#options.resolveEnabled && !this.#options.resolveEnabled(manifest.id)) {
      return {
        path: pluginPath,
        id: manifest.id,
        status: 'disabled',
        manifest,
        granularity: manifest.granularity ?? 'bundle',
        reason: PLUGIN_LOADER_TEXTS.disabledByConfig,
      };
    }

    // --- extension imports + kind validation ------------------------------
    const loaded: ILoadedExtension[] = [];
    for (const relEntry of manifest.extensions) {
      const result = await this.#loadAndValidateExtensionEntry(pluginPath, manifest, relEntry);
      if (!result.ok) return result.failure;
      loaded.push(result.extension);
    }

    // --- storage output schemas (spec § A.12) -----------------------------
    // Opt-in: only plugins that declare `storage.schemas` (Mode B) or
    // `storage.schema` (Mode A) trigger the read+compile pass. A schema
    // file missing on disk OR failing AJV compile blocks the load with
    // `load-error` so the user sees the typo or syntax error at boot
    // instead of at first write. Storage modes without any schema
    // declaration stay permissive (status quo), `storageSchemas` is
    // simply omitted from the discovered plugin row.
    const storageSchemasResult = loadStorageSchemas(pluginPath, manifest);
    if (!storageSchemasResult.ok) {
      return {
        ...fail(pluginPath, manifest.id, 'load-error', storageSchemasResult.reason),
        manifest,
      };
    }

    return {
      path: pluginPath,
      id: manifest.id,
      status: 'enabled',
      manifest,
      granularity: manifest.granularity ?? 'bundle',
      extensions: loaded,
      ...(storageSchemasResult.schemas
        ? { storageSchemas: storageSchemasResult.schemas }
        : {}),
    };
  }

  /**
   * Phase 1 of `loadOne`, read `plugin.json`, AJV-validate the manifest,
   * enforce the directory-name == manifest.id structural rule, and check
   * specCompat (range syntax + satisfies the installed spec version).
   * Returns either the validated manifest or an `IDiscoveredPlugin` with
   * the appropriate failure status.
   */
  #parseAndValidateManifest(
    pluginPath: string,
  ): { ok: true; manifest: IPluginManifest } | { ok: false; failure: IDiscoveredPlugin } {
    const manifestPath = join(pluginPath, 'plugin.json');

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      return { ok: false, failure: fail(
        pluginPath,
        pathId(pluginPath),
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
        pathId(pluginPath),
        'invalid-manifest',
        tx(PLUGIN_LOADER_TEXTS.invalidManifestAjv, {
          manifestPath,
          errors: manifestResult.errors,
        }),
      )};
    }
    const manifest = manifestResult.data;

    // Cheap structural rule (spec § A.5, plugin id global uniqueness).
    // Two siblings on the same filesystem cannot share a name; matching
    // the directory to the id rules out same-root collisions by construction.
    const dirName = pathId(pluginPath);
    if (dirName !== manifest.id) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          manifest.id,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidManifestDirMismatch, {
            dirName,
            manifestId: manifest.id,
          }),
        ),
        manifest,
      }};
    }

    if (!semver.validRange(manifest.specCompat)) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          manifest.id,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidSpecCompat, { specCompat: manifest.specCompat }),
        ),
        manifest,
      }};
    }
    if (!semver.satisfies(this.#options.specVersion, manifest.specCompat, { includePrerelease: true })) {
      return { ok: false, failure: {
        path: pluginPath,
        id: manifest.id,
        status: 'incompatible-spec',
        manifest,
        granularity: manifest.granularity ?? 'bundle',
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
    manifest: IPluginManifest,
    relEntry: string,
  ): Promise<{ ok: true; extension: ILoadedExtension } | { ok: false; failure: IDiscoveredPlugin }> {
    if (!isInsidePlugin(pluginPath, relEntry)) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          manifest.id,
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
          manifest.id,
          'load-error',
          tx(PLUGIN_LOADER_TEXTS.loadErrorFileNotFound, { relEntry, abs }),
        ),
        manifest,
      }};
    }

    let mod: unknown;
    try {
      mod = await importWithTimeout(pathToFileURL(abs).href, this.#loadTimeoutMs);
    } catch (err) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          manifest.id,
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
    if (!isRecord(exported) || typeof exported['kind'] !== 'string') {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          manifest.id,
          'load-error',
          tx(PLUGIN_LOADER_TEXTS.loadErrorMissingKind, {
            relEntry,
            knownKindsList: KNOWN_KINDS_LIST,
          }),
        ),
        manifest,
      }};
    }

    const kind = exported['kind'] as ExtensionKind;
    if (!KNOWN_KINDS.has(kind)) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          manifest.id,
          'load-error',
          tx(PLUGIN_LOADER_TEXTS.loadErrorUnknownKind, {
            relEntry,
            kindReceived: String(exported['kind']),
            knownKindsList: KNOWN_KINDS_LIST,
          }),
        ),
        manifest,
      }};
    }

    // Spec § A.6, `pluginId` is loader-injected. A hand-declared
    // mismatch is a hard load error; a matching declaration is tolerated
    // (stripped before AJV).
    const declaredPluginId = exported['pluginId'];
    if (typeof declaredPluginId === 'string' && declaredPluginId !== manifest.id) {
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          manifest.id,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.loadErrorPluginIdMismatch, {
            relEntry,
            declared: declaredPluginId,
            manifestId: manifest.id,
          }),
        ),
        manifest,
      }};
    }

    // Strip runtime methods + `pluginId` so AJV's strict
    // `unevaluatedProperties: false` doesn't reject the export.
    const manifestView = stripFunctionsAndPluginId(exported);

    if (kind === 'hook') {
      const hookFailure = validateHookTriggers(pluginPath, manifest, relEntry, exported, manifestView);
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
      const errors = (extValidator.errors ?? [])
        .map((e) => `${e.instancePath || '(root)'} ${e.message ?? e.keyword}`)
        .join('; ');
      return { ok: false, failure: {
        ...fail(
          pluginPath,
          manifest.id,
          'invalid-manifest',
          tx(PLUGIN_LOADER_TEXTS.invalidManifestExtensionShape, { relEntry, kind, errors }),
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
      manifest,
      relEntry,
      manifestView,
    );
    if (contribFailure) return { ok: false, failure: contribFailure };

    // Shallow-clone the runtime instance + inject `pluginId` so two
    // plugins importing the same ESM-cached file don't stomp each
    // other's `pluginId`.
    const instance = isRecord(exported)
      ? { ...exported, pluginId: manifest.id }
      : exported;

    return { ok: true, extension: {
      kind,
      id: exported['id'] as string,
      pluginId: manifest.id,
      version: exported['version'] as string,
      entryPath: abs,
      module: mod,
      instance,
    }};
  }
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
