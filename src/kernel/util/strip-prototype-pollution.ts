/**
 * Shared prototype-pollution defence used at every trust boundary where
 * untrusted JSON / YAML enters the runtime (settings, sidecars, plugin
 * manifests).
 *
 * Two surfaces:
 *
 *   1. `FORBIDDEN_KEYS` — the closed set of key names that manipulate
 *      the prototype chain. Merge functions consult this directly to
 *      skip keys without cloning (see `kernel/config/loader.ts` and
 *      `kernel/sidecar/store.ts`).
 *
 *   2. `stripPrototypePollution(value)` — pure: returns a deep-cloned
 *      copy of `value` with every forbidden key removed at every depth.
 *      Primitives pass through unchanged. Arrays recurse element-wise.
 *      Plain objects have their entries filtered and recursed.
 *      Non-plain objects (Date, Map, class instances) are returned
 *      as-is, since they are never produced by `JSON.parse` /
 *      `yaml.load` on the data we accept.
 *
 * Use the strip helper at the read boundary; consult `FORBIDDEN_KEYS`
 * inside merge primitives. Centralising both means the day a fourth
 * forbidden name surfaces (rare but possible — engine-specific
 * accessors), we update one file.
 */

export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export function stripPrototypePollution<T>(value: T): T {
  return strip(value) as T;
}

function strip(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(strip);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    out[k] = strip(v);
  }
  return out;
}
