/**
 * Dynamic-import helpers used by the loader's extension-entry phase:
 * timeout-bounded `import()`, default-export extraction, and the two
 * AJV-friendly views over an extension's runtime export (strip
 * functions / `pluginId`, strip per-kind runtime fields).
 */

import { PLUGIN_LOADER_TEXTS } from '../../i18n/plugin-loader.texts.js';
import { tx } from '../../util/tx.js';
import { isRecord } from './id-utils.js';

/**
 * Race the dynamic import against a timer. When the timer wins we throw
 * a clear timeout error, the caller turns it into a `load-error` row
 * naming the offending entry. The dangling import promise lingers in
 * Node's loader and resolves later (the result is GC'd unreferenced);
 * there is no public `import()` cancellation API in Node 24, so this
 * is the best we can do without spawning a worker thread.
 */
export async function importWithTimeout(href: string, timeoutMs: number): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(tx(PLUGIN_LOADER_TEXTS.importExceededTimeout, { timeoutMs })));
    }, timeoutMs);
  });
  try {
    return await Promise.race([import(href), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function extractDefault(mod: unknown): unknown {
  if (!isRecord(mod)) return mod;
  return 'default' in mod ? mod['default'] : mod;
}

/**
 * Drop function-typed properties AND the runtime-only `pluginId` so the
 * resulting object is JSON-Schema-validatable. Used on the runtime export
 * before AJV gets it: an extension's `detect` / `render` / etc. method is
 * part of its TypeScript contract, not its declarative manifest, and JSON
 * Schema's `unevaluatedProperties: false` posture would otherwise reject
 * the whole export. Same posture for `pluginId`, per spec § A.6 it's a
 * runtime concern injected by the loader, not a manifest field.
 *
 * The structure-as-truth fields (`id` / `kind` / `kinds` / `formatId`)
 * are deliberately NOT stripped here: the loader's strict guard rejects a
 * manifest that re-declares any of them before this runs, so the AJV view
 * never carries them. Provider `kinds` are discovered from the
 * `kinds/<kindName>/` folder layout and injected at instance-build time,
 * after AJV, so they never reach this view either.
 *
 * Cheap shallow copy, manifests are flat enough.
 */
/**
 * Manifest keys the loader injects rather than reads from the export.
 *
 * `pluginId` is a runtime concern injected from `plugin.json#/id` (spec
 * § A.6); declaring it is tolerated when it matches (the loader's
 * dedicated mismatch check in `index.ts` rejects a divergent value), so
 * it is stripped here before AJV sees the export.
 *
 * The structure-as-truth fields (`id` / `kind` / `kinds` / `formatId`)
 * are NOT stripped: a manifest re-declaring any of them is rejected as
 * `invalid-manifest` by the loader's strict guard (`index.ts`) before
 * this strip runs, so they never reach the AJV view. The kind schemas'
 * `unevaluatedProperties: false` is the backstop if the guard ever misses.
 */
const LOADER_INJECTED_KEYS = new Set(['pluginId']);

export function stripFunctionsAndPluginId(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'function') continue;
    if (LOADER_INJECTED_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Runtime-only fields of a Provider's `activity` capability. Both are
 * documented in `provider.schema.json#/properties/activity` and
 * `spec/provider-activity.md` as TypeScript-only, "MUST NOT appear in the
 * manifest": `mapEvent` is the raw-payload mapper, `pluginHooksSource` the
 * in-process hook-registration source spliced into the generated plugin
 * file. Built-ins carry both on the runtime object and never hit the
 * loader's AJV pass; an EXTERNAL provider ships the same object literal,
 * so the loader must drop these from the validatable view (the top-level
 * function strip is shallow and cannot reach a nested method or a string).
 * The instance is rebuilt from the untouched export, so both survive at
 * runtime for `sm activity install` / the ingest mapper.
 */
const ACTIVITY_RUNTIME_KEYS = new Set(['pluginHooksSource', 'mapEvent']);

/**
 * Reduce a provider manifest view's `activity` block to its declarative
 * half (`install`) by dropping the runtime-only keys above. No-op when the
 * export declares no `activity` object. Applied AFTER
 * `stripFunctionsAndPluginId`, before the provider AJV pass.
 */
export function stripActivityRuntimeFields(view: unknown): unknown {
  if (!isRecord(view)) return view;
  const activity = view['activity'];
  if (!isRecord(activity)) return view;
  const cleanedActivity: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(activity)) {
    if (ACTIVITY_RUNTIME_KEYS.has(k)) continue;
    cleanedActivity[k] = v;
  }
  return { ...view, activity: cleanedActivity };
}

// `stripKindsRuntimeFields` was retired with the structure-as-truth
// refactor: the Provider `kinds` map is sourced from the
// `<plugin>/kinds/<kindName>/` folder layout (see `discoverProviderKinds`
// in `validation.ts`) and injected after AJV, so it never reaches the
// validatable view. A manifest that inlines `kinds` is now rejected by
// the loader's strict guard rather than silently stripped.
