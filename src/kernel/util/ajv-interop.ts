/**
 * Lazy loader + ESM/CJS interop for `ajv` / `ajv-formats`.
 *
 * Two jobs, one chokepoint:
 *
 *   1. **Sync-lazy module load** (2026-08 perf sprint follow-up). Every
 *      `new Ajv2020(...)` in the codebase already lives inside a lazy
 *      builder function, but the top-level VALUE imports still forced
 *      ajv's whole module graph onto the boot path of every verb
 *      (~30 ms measured), including verbs that never validate anything.
 *      `loadAjv()` defers the load to first construction and stays
 *      SYNCHRONOUS via `createRequire` (ajv ships CJS), so no builder
 *      signature changes. Consumers keep their `import type` lines
 *      (erased at build) and call `loadAjv()` where they construct.
 *   2. **`ajv-formats` interop**: the package ships CJS-first; the
 *      default export is the callable plugin under ESM interop, but TS
 *      sometimes types it as the namespace. `applyAjvFormats` normalises
 *      that once so adapters don't each carry the same cast.
 *
 * Usage:
 *   import { applyAjvFormats, loadAjv } from '<...>/kernel/util/ajv-interop.js';
 *   const { Ajv2020 } = loadAjv();
 *   const ajv = new Ajv2020({ ... });
 *   applyAjvFormats(ajv);
 */

import { createRequire } from 'node:module';

import type { Ajv2020 } from 'ajv/dist/2020.js';

type TAjv = InstanceType<typeof Ajv2020>;
type TAddFormats = (ajv: TAjv) => void;

interface IAjvModule {
  Ajv2020: typeof Ajv2020;
}

/**
 * Resolves relative to THIS module's on-disk location (dist chunk in
 * the published package, `src/kernel/util/` in dev), so `ajv` comes
 * from the package's own dependency tree in both layouts.
 */
const requireCjs = createRequire(import.meta.url);

let ajvModule: IAjvModule | null = null;
let addFormats: TAddFormats | null = null;

/** Load (once) and return the ajv module's value surface. */
export function loadAjv(): IAjvModule {
  ajvModule ??= requireCjs('ajv/dist/2020.js') as IAjvModule;
  return ajvModule;
}

/**
 * Wire the standard JSON Schema formats (`uri`, `date`, `date-time`,
 * etc.) onto the given Ajv instance. Loads `ajv-formats` on first use.
 */
export function applyAjvFormats(ajv: TAjv): void {
  if (addFormats === null) {
    const mod = requireCjs('ajv-formats') as TAddFormats & { default?: TAddFormats };
    addFormats = mod.default ?? mod;
  }
  addFormats(ajv);
}
