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
 * a clear timeout error — the caller turns it into a `load-error` row
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
 * the whole export. Same posture for `pluginId` — per spec § A.6 it's a
 * runtime concern injected by the loader, not a manifest field.
 *
 * Spec 0.8.0: Provider runtime instances carry an additional
 * runtime-only field per `kinds` entry — `schemaJson`, the loaded JSON
 * Schema for the kind. The manifest declares `schema` (a relative path
 * string); `schemaJson` is loaded by the kernel/loader at boot. Strip
 * it before AJV-validating against the strict provider schema (which
 * has `additionalProperties: false` on each kind entry).
 *
 * Cheap shallow + one-level-deep copy — manifests are flat enough.
 */
export function stripFunctionsAndPluginId(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'function') continue;
    if (k === 'pluginId') continue;
    if (k === 'kinds' && isRecord(v)) {
      out[k] = stripKindsRuntimeFields(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Provider `kinds` map: for each entry, drop runtime-only fields
 * (`schemaJson`) so AJV sees only the manifest-level fields the spec
 * declares (`schema`, `defaultRefreshAction`).
 */
export function stripKindsRuntimeFields(kinds: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [kind, entry] of Object.entries(kinds)) {
    if (!isRecord(entry)) {
      out[kind] = entry;
      continue;
    }
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) {
      if (k === 'schemaJson') continue;
      if (typeof v === 'function') continue;
      cleaned[k] = v;
    }
    out[kind] = cleaned;
  }
  return out;
}
