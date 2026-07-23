/**
 * Locked built-in extension ids, DERIVED from the manifests' `locked`
 * flag (decision 2026-07-23, replacing the former hardcoded kernel
 * lock-list `kernel/config/locked-plugins.ts`): the kernel stays
 * plugin-agnostic, the knowledge of WHICH extensions are locked lives
 * on each extension's own manifest, and this helper is the plugin-space
 * projection the host layers (CLI verbs, BFF routes, resolver
 * construction sites) consume.
 *
 * Lock semantics (normative: `spec/architecture.md` §Locked
 * extensions): the enabled-resolver returns `true` for a locked
 * qualified id before consulting any config layer; toggle surfaces
 * reject writes (403 `locked` / exit 5, bulk skips silently); locked
 * ids are never trust-gated. The flag is HOST-RESERVED: absent from
 * `base.schema.json`, so an external plugin declaring it fails load.
 */

import { builtIns } from './built-ins.js';

let cached: ReadonlySet<string> | null = null;

/**
 * Qualified ids (`<plugin>/<extension>`) of every built-in whose
 * manifest declares `locked: true`. Computed once (the built-ins
 * catalog is static per process); reads the FULL manifests via
 * `builtIns()` (the `listBuiltIns()` row projection does not carry the
 * flag).
 */
export function lockedBuiltInIds(): ReadonlySet<string> {
  if (cached === null) {
    const b = builtIns();
    const all = [
      ...b.providers,
      ...b.extractors,
      ...b.analyzers,
      ...b.formatters,
      ...b.actions,
      ...b.hooks,
    ];
    cached = new Set(
      all.filter((ext) => ext.locked === true).map((ext) => `${ext.pluginId}/${ext.id}`),
    );
  }
  return cached;
}

/** True when the qualified extension id is host-locked. */
export function isLockedBuiltIn(idOrQualified: string): boolean {
  return lockedBuiltInIds().has(idOrQualified);
}
