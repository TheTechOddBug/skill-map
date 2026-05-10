/**
 * Step 9.6.6 — runtime annotation-contribution catalog types.
 *
 * Lives in its own module (rather than `kernel/index.ts`) so consumers
 * deep inside the kernel — `IAnalyzerContext`, the BFF route factories,
 * future Action contexts — can depend on the catalog shape without
 * dragging the whole kernel barrel and risking a cycle.
 */

/**
 * Single row of the runtime annotation-contribution catalog surfaced by
 * `kernel.getRegisteredAnnotationKeys()`. One row per (plugin × key)
 * tuple. Built-in catalog keys from `annotations.schema.json` are NOT
 * included — this catalog is plugin-only; the UI knows the built-in
 * catalog via the schema bundle.
 */
export interface IRegisteredAnnotationKey {
  pluginId: string;
  key: string;
  location: 'namespaced' | 'root';
  ownership: 'exclusive' | 'shared';
  /** Inline JSON Schema as declared in the manifest (not the AJV compiled validator). */
  schema: Record<string, unknown>;
}
