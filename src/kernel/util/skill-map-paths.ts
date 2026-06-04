/**
 * Kernel-side helpers that compose the layered-config file paths from
 * the canonical `SKILL_MAP_DIR` literal.
 *
 * This is the CANONICAL home for the literal (audit m3, one literal
 * home, no `grep "'\.skill-map'"` sweep invariant to maintain). The
 * kernel is the innermost layer, so the literal lives here and the
 * `core/` path helpers (`core/paths/db-path.ts`) re-export it DOWNward,
 * never the reverse. `KERNEL_SKILL_MAP_DIR` stays as the historic
 * kernel-side alias for callers that already use that name
 * (`conformance/index.ts`).
 */

import { join } from 'node:path';

/**
 * Per-scope directory the kernel + CLI both store state under (DB file,
 * settings, plugins, etc.). The single canonical source for the literal;
 * `core/paths/db-path.ts` re-exports it.
 */
export const SKILL_MAP_DIR = '.skill-map';

/** Historic kernel-side alias for {@link SKILL_MAP_DIR}. */
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
