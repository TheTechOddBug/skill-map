/**
 * Base manifest shape shared by every extension kind. Mirrors
 * `spec/schemas/extensions/base.schema.json` at the TypeScript level.
 *
 * Spec § A.6 — every extension is identified in the registry by the
 * qualified id `<pluginId>/<id>`. The `pluginId` field is required at the
 * runtime / TS level: built-ins declare it directly in
 * `src/extensions/built-ins.ts`; user plugins have it injected by the
 * `PluginLoader` from `plugin.json#/id` before the extension reaches the
 * registry. A plugin author who hand-codes a `pluginId` that disagrees
 * with the manifest's `id` is rejected as `invalid-manifest`.
 *
 * The JSON Schema deliberately does NOT model `pluginId` — the qualifier
 * is a runtime concern composed by the loader, not a manifest field
 * authors are expected to set. Stripping it before AJV validation in
 * the loader keeps the spec contract clean ("authors declare only the
 * short id").
 */

import type { Stability } from '../types.js';
import type { IViewContribution } from '../types/view-catalog.js';

/**
 * Step 9.6.6 — single entry of an extension's `annotationContributions`
 * map. Mirrors `spec/schemas/extensions/base.schema.json#/properties/annotationContributions/additionalProperties`.
 *
 * `schema` is an INLINE JSON Schema (object literal in the manifest),
 * not a `$ref` to a file. The kernel compiles it at load time; an
 * invalid schema rejects the extension as `invalid-manifest`.
 */
export interface IAnnotationContribution {
  /** Inline JSON Schema describing the value written under this key. */
  schema: Record<string, unknown>;
  /**
   * Conflict policy. `shared` (default) — multiple plugins MAY write
   * the key; `exclusive` — only this plugin may. REQUIRED to be
   * `'exclusive'` when `location: 'root'`.
   */
  ownership?: 'exclusive' | 'shared';
  /**
   * Where the key lands. `namespaced` (default) — under the plugin's
   * `<plugin-id>:` block; `root` — top-level, alongside `for` /
   * `annotations` / `settings` / `audit`. Cross-plugin root-key
   * collisions on `exclusive` are a fatal startup error.
   */
  location?: 'namespaced' | 'root';
}

export interface IExtensionBase {
  id: string;
  /**
   * Owning plugin namespace. Composed with `id` to produce the
   * qualified registry key `<pluginId>/<id>`. Built-ins declare this
   * directly; user plugins have it injected by the `PluginLoader`
   * from `plugin.json#/id`.
   */
  pluginId: string;
  version: string;
  description?: string;
  stability?: Stability;
  preconditions?: string[];
  entry?: string;
  /**
   * Step 9.6.6 — plugin-contributed annotation keys. Each entry maps a
   * key name to an inline JSON Schema + ownership + location triple.
   * The kernel surfaces the aggregate via `kernel.getRegisteredAnnotationKeys()`.
   * See `IAnnotationContribution` for the field semantics and
   * `plugin-author-guide.md` §Annotation contributions for examples.
   */
  annotationContributions?: Record<string, IAnnotationContribution>;
  /**
   * Plugin-contributed view contributions. Each entry maps a local
   * contribution id (kebab-case, unique within the extension) to a
   * `IViewContribution` declaration that picks a view contract by name
   * from the closed kernel catalog (`view-catalog.ts#TContractName`).
   * The kernel validates each `contract` pick at load time
   * (`invalid-manifest` on miss); the plugin emits per-node payloads
   * via `ctx.emitContribution(<contributionId>, payload)` during scan;
   * the runtime validates payloads against the contract's payload
   * schema. The aggregate runtime catalog is exposed via
   * `kernel.getRegisteredViewContributions()`. The plugin author
   * NEVER picks a UI slot — slot mapping is owned by the UI driving
   * adapter. See `architecture.md` §View contribution system.
   */
  viewContributions?: Record<string, IViewContribution>;
}
