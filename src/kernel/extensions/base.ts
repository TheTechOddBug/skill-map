/**
 * Base extension shape shared by every kind. Mirrors
 * `spec/schemas/extensions/base.schema.json` at the TypeScript level.
 *
 * **Structure-as-truth**: the manifest authored on disk no longer carries
 * `id` or `kind`. Both fields are derived from the filesystem path
 * (`<plugin>/<kind-plural>/<id>/index.ts`, parent folder dictates kind, leaf
 * folder dictates id). The loader strips/rejects any `id` / `kind` literals
 * a hand-written manifest carries and injects the derived values into the
 * runtime descriptor before it reaches the registry. The qualified registry
 * key is `<pluginId>/<id>`; `pluginId` similarly comes from the plugin's
 * folder name and is injected at load time.
 */

import type { TSettingValue, IViewContribution } from '../types/view-catalog.js';
import type { TSettingDeclaration } from '../types/view-catalog.js';

/**
 * Single declaration of an extension's optional sidecar annotation
 * contribution. The annotation key is the extension's id (the leaf folder
 * name); to contribute additional keys, split into additional extensions.
 * Mirrors `spec/schemas/extensions/base.schema.json#/properties/annotation`.
 */
export interface IAnnotationContribution {
  /** Inline JSON Schema describing the value written under this key. */
  schema: Record<string, unknown>;
  /**
   * Conflict policy. `shared` (default): multiple plugins MAY write the
   * key; `exclusive`: only this plugin may. REQUIRED to be `'exclusive'`
   * when `location: 'root'`.
   */
  ownership?: 'exclusive' | 'shared';
  /**
   * Where the key lands. `namespaced` (default): under the plugin's
   * `<plugin-id>:` block; `root`: top-level, alongside `for` /
   * `annotations` / `settings` / `audit`. Cross-plugin root-key
   * collisions on `exclusive` are a fatal startup error.
   */
  location?: 'namespaced' | 'root';
}

/**
 * Runtime extension descriptor as seen by the registry / orchestrator.
 * Authors writing a manifest on disk do NOT declare `id`, `kind`, or
 * `pluginId`; the loader injects all three from the filesystem layout.
 *
 * `version` is the runtime invariant: every loaded extension carries a
 * string. External plugins MUST declare it in their manifest (enforced
 * by AJV via `spec/schemas/extensions/base.schema.json#/required`).
 * Built-in extensions inside this repo OMIT `version` from the manifest
 * file (see `IBuiltInManifest` below) because the codegen at
 * `scripts/generate-built-ins.js` stamps the CLI version onto every
 * built-in at build time, alongside the `pluginId` stamp.
 */
export interface IExtensionBase {
  /**
   * Short id, the leaf folder name of the extension. Injected by the
   * loader. Hand-authored manifests carrying an `id` literal are
   * rejected as `invalid-manifest`.
   */
  id: string;
  /**
   * Owning plugin namespace, the plugin folder name. Composed with `id`
   * to produce the qualified registry key `<pluginId>/<id>`. Injected
   * by the loader.
   */
  pluginId: string;
  version: string;
  /** Required short description shown by `sm <kind>s list` / UI. */
  description: string;
  /**
   * Optional opt-in single annotation contribution. Renamed from
   * `annotationContributions` (mapa) with the structure-as-truth
   * refactor; the key is the extension's id, so only the schema +
   * ownership + location triple lives in the manifest.
   */
  annotation?: IAnnotationContribution;
  /**
   * Optional extension-scoped user settings. Moved here from
   * `plugin.json` with the structure-as-truth refactor: settings now
   * live with the extension that consumes them, exposed at runtime as
   * `ctx.settings.<settingId>`. Settings are read once at extension
   * invocation; changing a setting requires `sm scan` to re-emit.
   */
  settings?: Record<string, TSettingDeclaration>;
  /**
   * Resolved values of the settings declared above, populated by the
   * orchestrator from project config + user overrides. Runtime-only,
   * never written to disk by authors.
   */
  resolvedSettings?: Record<string, TSettingValue>;
  /**
   * Optional plugin-contributed view contributions. Renamed from
   * `viewContributions` with the structure-as-truth refactor. Each
   * entry maps a local contribution id (kebab-case, unique within the
   * extension) to an `IViewContribution` that picks a view slot by
   * name from the closed catalog. Only `extractor` and `analyzer` kinds
   * may declare this field.
   */
  ui?: Record<string, IViewContribution>;
  /** Runtime-only, absolute path of the extension entry file. */
  entry?: string;
}

/**
 * Authoring type for built-in extension manifests under `src/plugins/`.
 * Omits `version` because the codegen at
 * `scripts/generate-built-ins.js` stamps the CLI version onto every
 * built-in at build time (alongside the `pluginId` stamp), so authors
 * never declare it. The resulting runtime object in
 * `src/plugins/built-ins.ts` satisfies the full kind interface (e.g.
 * `IAnalyzer`) and consumers continue to see `version: string`.
 *
 * External plugins (loaded from disk at runtime) do NOT use this type
 * and MUST declare `version` per-extension as required by
 * `spec/schemas/extensions/base.schema.json#/required` (enforced by
 * AJV at load time).
 */
export type IBuiltInManifest<T extends IExtensionBase> = Omit<T, 'version'>;
