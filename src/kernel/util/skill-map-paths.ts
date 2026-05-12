/**
 * Kernel-side helpers that compose the layered-config file paths from
 * the canonical `SKILL_MAP_DIR` literal.
 *
 * `SKILL_MAP_DIR` is exported once from `core/paths/db-path.ts` and
 * re-exported here as `KERNEL_SKILL_MAP_DIR` so kernel-side callers
 * keep their historic name without the literal living in two files
 * (audit m3, one literal home, no `grep "'\.skill-map'"` sweep
 * invariant to maintain across kernel + CLI).
 */

import { join } from 'node:path';

import { SKILL_MAP_DIR } from '../../core/paths/db-path.js';

/**
 * Per-scope directory the kernel + CLI both store state under (DB file,
 * settings, plugins, etc.). Re-exported from `core/paths/db-path.ts`
 * the single canonical source for the literal.
 */
export const KERNEL_SKILL_MAP_DIR = SKILL_MAP_DIR;

const SETTINGS_FILENAME = 'settings.json';
const LOCAL_SETTINGS_FILENAME = 'settings.local.json';

/**
 * `<scopeRoot>/.skill-map/settings.json`, the canonical layered-config
 * file. Used by `kernel/config/loader.ts` to compose its user / project
 * walk.
 */
export function kernelSettingsPath(scopeRoot: string): string {
  return join(scopeRoot, KERNEL_SKILL_MAP_DIR, SETTINGS_FILENAME);
}

/**
 * `<scopeRoot>/.skill-map/settings.local.json`, the local-overrides
 * companion to `settings.json`. Used by the same loader walk.
 */
export function kernelLocalSettingsPath(scopeRoot: string): string {
  return join(scopeRoot, KERNEL_SKILL_MAP_DIR, LOCAL_SETTINGS_FILENAME);
}
