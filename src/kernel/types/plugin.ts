/**
 * Plugin-surface types, hand-written to mirror
 * `spec/schemas/plugins-registry.schema.json#/$defs/PluginManifest` and the
 * extension-kind manifests under `spec/schemas/extensions/`.
 *
 * Per ROADMAP §DTO gap (review-pass decision): the proper emission of
 * typed DTOs from `@skill-map/spec` is deferred to a future iteration when a
 * third consumer (real providers / extractors / rules) forces a single
 * source of truth. Until then, both `ui/src/models/` and `src/kernel/types/`
 * hand-curate their own local mirror, the risk of drift is accepted at
 * this scale (17 schemas) and flagged in the roadmap.
 */

import type { TExtensionStability } from '../extensions/base.js';
import type { ExtensionKind } from '../registry.js';

export type { ExtensionKind } from '../registry.js';
export type { TSettingDeclaration } from './view-catalog.js';

/**
 * Plugin storage mode. Matches the `oneOf` in the plugin manifest schema:
 * either shared `state_plugin_kvs` (mode `kv`) or dedicated plugin-owned
 * tables with explicit migrations (mode `dedicated`). Absent = the plugin
 * does not persist state at all.
 *
 * Optional output-schema declarations (spec § A.12, opt-in correctness
 * for plugin custom storage):
 *   - Mode `kv` → `schema` (single relative path). Validates the value
 *     written by `ctx.store.set(key, value)`.
 *   - Mode `dedicated` → `schemas` (per-table relative paths). Validates
 *     each row written by `ctx.store.write(table, row)` whose table has
 *     a declared schema; tables absent from the map accept any shape.
 *
 * Absent in both cases = permissive (status quo, no validation). Schema
 * load failures surface as `load-error`. `emitLink` and `enrichNode`
 * keep their universal kernel validation regardless of these fields.
 */
export type TPluginStorage =
  | { mode: 'kv'; schema?: string }
  | { mode: 'dedicated'; tables: string[]; migrations: string[]; schemas?: Record<string, string> };

/**
 * Raw `plugin.json` shape after successful AJV validation.
 *
 * **Structure-as-truth**: the plugin id comes from the directory name
 * (`<root>/<id>/plugin.json`); it is NOT a manifest field. The loader
 * rejects manifests carrying an `id` literal. Settings moved out of
 * `plugin.json` into each extension's own manifest with the same refactor.
 */
export interface IPluginManifest {
  version: string;
  specCompat: string;
  /**
   * Required semver range against the kernel's view-slots + input-types
   * catalog version. Mismatch surfaces as `incompatible-catalog`. Promoted
   * from optional to required with the structure-as-truth refactor,
   * declaring compat is part of the plugin contract regardless of which
   * catalog surfaces it actually consumes.
   */
  catalogCompat: string;
  /** Required short description shown in `sm plugins list` and the UI. */
  description: string;
  /**
   * Optional inspector-only ordering hint (default 100). Sorts the
   * per-plugin sections in the inspector body. Never affects execution
   * order. See `plugins-registry.schema.json#/$defs/PluginManifest`.
   */
  order?: number;
  storage?: TPluginStorage;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
}

/**
 * Failure mode produced by the loader when a plugin cannot be loaded.
 * Matches the three states named in spec §Plugin discovery / load.
 *
 * - `incompatible-spec`: manifest parsed fine but `semver.satisfies` failed
 *   against the installed `@skill-map/spec` version.
 * - `invalid-manifest`: `plugin.json` missing, unparseable, failing AJV on
 *   the base manifest schema, OR the exported extension shape failed its
 *   kind-specific schema (per spec/architecture.md §Plugin discovery,
 *   "AJV rejects unknown `slot` names with `invalid-manifest`").
 * - `load-error`: manifest parsed but an extension module failed to import.
 */
/**
 * Possible outcomes after the loader sees a plugin.json. Mirrors the
 * `status` enum in `spec/schemas/plugins-registry.schema.json`.
 *
 * - `enabled`            , manifest valid, specCompat satisfied, every
 *                           extension imported and validated.
 * - `disabled`           , user-toggled off via `sm plugins disable` or
 *                           `settings.json#/plugins/<id>/enabled`. Manifest
 *                           is parsed and surfaced (so `sm plugins list`
 *                           shows it), but extensions are not imported.
 * - `incompatible-spec`  , manifest parsed but `semver.satisfies` failed.
 * - `invalid-manifest`   , `plugin.json` missing, unparseable, AJV-fails,
 *                           OR the directory name does not equal the
 *                           manifest id (a cheap structural rule that
 *                           rules out same-root collisions by construction:
 *                           a filesystem cannot contain two siblings with
 *                           the same name).
 * - `load-error`         , manifest passed, an extension module failed.
 * - `id-collision`       , two plugins reachable from different roots
 *                           (project + global, or any `--plugin-dir`
 *                           combination) declared the same `id`. Both
 *                           collided plugins receive this status; no
 *                           precedence rule applies. The user resolves
 *                           by renaming one of them and rerunning.
 */
export type TPluginLoadStatus =
  | 'enabled'
  | 'disabled'
  | 'incompatible-spec'
  | 'incompatible-catalog'
  | 'invalid-manifest'
  | 'load-error'
  | 'id-collision';

/**
 * The parsed `<plugin>/<kind-plural>/<id>/extension.json`, validated
 * against `spec/schemas/extensions/extension-manifest.schema.json`.
 *
 * This is the DECLARATIVE half of an extension, and it exists so the
 * loader can answer "may this run?" without running it. The enabled
 * decision depends on `stability` / `defaultEnabled`; while those lived
 * in the module you had to `import()` the code to discover you were not
 * allowed to `import()` it. Reading JSON is not execution, so the gate
 * now closes ahead of the import.
 */
export interface IExtensionJsonMeta {
  version: string;
  description: string;
  stability?: TExtensionStability;
  defaultEnabled?: boolean;
}

/**
 * An extension that exists on disk but whose module was deliberately
 * NOT imported: no trust grant, the plugin is disabled, or this
 * particular extension is disabled.
 *
 * It carries real metadata rather than a bare id because
 * `extension.json` is readable without executing anything, so an
 * operator can review a project-local plugin's full inventory BEFORE
 * granting it trust, which is exactly what the untrusted advisory tells
 * them to do.
 *
 * Deliberately NOT an `ILoadedExtension` with optional fields, and
 * deliberately not folded into `IDiscoveredPlugin.extensions`: it has no
 * `instance` and no `module`, so it is structurally incapable of
 * reaching the registry, the composer or the orchestrator. Membership in
 * `extensions` is the proof that an extension was allowed to execute;
 * nothing here can be mistaken for that.
 */
export interface IUnloadedExtension {
  kind: ExtensionKind;
  id: string;
  pluginId: string;
  version: string;
  description: string;
  stability?: TExtensionStability;
  defaultEnabled?: boolean;
  /** What WOULD have been imported. Never imported. */
  entryPath: string;
  reason: TUnloadedReason;
}

/**
 * Why an on-disk extension was not imported. Kept distinct so the CLI
 * can tell an operator whether to run `sm plugins trust` (a security
 * decision) or `sm plugins enable` (an operational one); conflating them
 * is how an operator learns to reflexively grant trust.
 */
export type TUnloadedReason =
  | 'plugin-untrusted'
  | 'plugin-disabled'
  | 'extension-disabled';

export interface ILoadedExtension {
  kind: ExtensionKind;
  id: string;
  /**
   * Owning plugin namespace, `manifest.id` of the `plugin.json` that
   * declared this extension. Composed with `id` to form the qualified
   * registry key `<pluginId>/<id>`. Per spec § A.6 the loader injects
   * this from the manifest; an extension that hand-declares a
   * mismatching `pluginId` is rejected as `invalid-manifest`.
   */
  pluginId: string;
  version: string;
  /**
   * Short description, read from `extension.json`. Stamped here (and
   * merged onto `instance`) so consumers read a typed field instead of
   * shape-checking the module export.
   */
  description: string;
  /**
   * Optional lifecycle label read from `extension.json`. Stamped here by
   * the loader so consumers (CLI list/show, BFF projection) read a typed
   * field instead of shape-checking `instance`. Absent when the file
   * does not declare it.
   */
  stability?: TExtensionStability;
  /**
   * Optional installed-default override (spec
   * `extension-manifest.schema.json#/properties/defaultEnabled`): a
   * declared value wins over the stability-derived default when
   * resolving the enabled axis.
   */
  defaultEnabled?: boolean;
  entryPath: string;
  /** Raw module namespace as returned by the dynamic `import()`. */
  module: unknown;
  /**
   * Runtime extension instance ready for the registry / orchestrator,
   * the `default` export of `module` (or the module itself when no
   * default), shallow-cloned with `pluginId` injected per spec § A.6.
   *
   * The clone is essential: ESM caches the imported module, so two
   * plugins importing the same file would otherwise share a single
   * mutable instance and overwrite each other's `pluginId`. The loader
   * owns the clone so consumers (CLI, tests) never need to mutate.
   */
  instance: unknown;
}

export interface IDiscoveredPlugin {
  /** Absolute path to the plugin directory. */
  path: string;
  /** Plugin id, populated from the manifest if it parsed, else a path hint. */
  id: string;
  status: TPluginLoadStatus;
  /** Only present when status === 'enabled' or 'incompatible-spec'. */
  manifest?: IPluginManifest;
  /**
   * Only present when status === 'enabled'.
   *
   * **Membership here is the proof that an extension was allowed to
   * execute**: it means the plugin was trusted, the plugin was enabled,
   * this extension was enabled, and only then was its module imported.
   * Everything discovered but not imported rides in
   * `unloadedExtensions` instead. Consumers that feed the registry, the
   * composer or the orchestrator read ONLY this field, which is what
   * makes "disabled code never runs" a structural property rather than a
   * convention every call site has to remember.
   */
  extensions?: ILoadedExtension[];
  /**
   * Extensions found on disk whose module was deliberately not imported
   * (untrusted plugin, disabled plugin, or disabled extension).
   *
   * `extensions` ∪ `unloadedExtensions` is the plugin's full declared
   * inventory. Present alongside `extensions` on an `enabled` plugin
   * (some of its extensions may be individually disabled) and alongside
   * a `disabled` status (where `extensions` is absent entirely).
   *
   * Populated from each extension's `extension.json`, so it costs no
   * code execution and stays available exactly when the operator most
   * needs it: reviewing a project-local plugin before trusting it.
   */
  unloadedExtensions?: IUnloadedExtension[];
  /**
   * Runtime-only, never persisted, never spec-modeled.
   *
   * Spec § A.12, opt-in JSON Schema validation for plugin custom storage.
   * Populated by the loader when `manifest.storage.schemas` (Mode B) or
   * `manifest.storage.schema` (Mode A) declares schema paths the loader
   * successfully read and AJV-compiled. Consumed by the runtime store
   * wrapper to validate `ctx.store.write(table, row)` (Mode B) and
   * `ctx.store.set(key, value)` (Mode A) before persisting.
   *
   * Mode B layout, keyed by logical table name (without the
   * `plugin_<normalizedId>_` prefix), matching the manifest's `schemas`
   * map. Tables not present in the map accept any shape (permissive).
   *
   * Mode A layout, uses the sentinel key `__kv__` for the single
   * value-shape schema. The sentinel survives the runtime contract change
   * if Mode A ever grows multiple namespaces.
   *
   * Absent (`undefined`) when no schemas were declared OR when the load
   * surfaced a `load-error` (the discovered plugin keeps its failure
   * status; consumers must check `status === 'enabled'`).
   */
  storageSchemas?: Record<string, IPluginStorageSchema>;
  /** Human-readable diagnostic shown by `sm plugins list/show`. */
  reason?: string;
  /**
   * Runtime-only, never persisted, never spec-modeled.
   *
   * Set by the loader when a project-local disk plugin was discovered
   * (manifest parsed + surfaced) but its extension code was NOT imported
   * because the operator never granted local trust (no scope-lock
   * override enables the plugin or any of its extensions). The plugin
   * still rides as `status: 'disabled'` (extensions absent), this flag
   * lets the runtime distinguish "not yet trusted" from an explicit
   * `sm plugins disable`, so it can emit a one-time "found but not
   * loaded, run `sm plugins enable`" notice. See spec § Plugin trust.
   */
  untrusted?: boolean;
}

/**
 * Runtime-only, a single AJV-compiled storage schema attached to a
 * loaded plugin. The schema path (relative to the plugin directory) is
 * preserved so error messages can name the offending file. `validate`
 * is the AJV `ValidateFunction` itself: it returns `true` on shape
 * match, otherwise `false` with `validate.errors` populated. Typed
 * loosely here (no `ajv/dist/2020.js` import) to keep the shared type
 * module free of Ajv at compile time; the runtime adapter narrows.
 */
export interface IPluginStorageSchema {
  /** Plugin-relative path to the schema file (`storage.schemas[<table>]` or `storage.schema`). */
  schemaPath: string;
  /** AJV-compiled validator. `errors` is populated after a failed call. */
  validate: ((row: unknown) => boolean) & {
    errors?: { instancePath: string; message?: string; keyword: string }[] | null;
  };
}
