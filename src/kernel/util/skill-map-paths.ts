/**
 * Kernel-side canonical literals for the on-disk skill-map scope layout.
 *
 * The CLI side (`src/cli/util/db-path.ts`) is the authoritative source of
 * the directory name and per-file conventions for every CLI verb. The
 * kernel cannot import from `cli/util/`, so this file mirrors the bare
 * minimum the kernel needs (today: the layered config loader composes
 * the four `settings.json` / `settings.local.json` paths it walks).
 *
 * Kept intentionally small — only the literals + thin helpers the
 * kernel actually consumes. Adding new helpers here is allowed; adding
 * unrelated layout knowledge is not.
 *
 * The directory name itself is duplicated across the two files (kernel
 * and CLI) on purpose: a kernel→cli import would invert the layering,
 * and a third "shared/" home is overkill until a fourth caller appears.
 * Both literals must stay in lock-step — `grep "'\.skill-map'" src/`
 * sweep should only match these two files.
 */

import { join } from 'node:path';

/**
 * Per-scope directory the kernel + CLI both store state under (DB file,
 * settings, plugins, etc.). Same name in project (`<cwd>/.skill-map/`)
 * and global (`~/.skill-map/`) scopes; the difference is the parent.
 * Mirrors `cli/util/db-path.ts`'s `SKILL_MAP_DIR`.
 */
export const KERNEL_SKILL_MAP_DIR = '.skill-map';

const SETTINGS_FILENAME = 'settings.json';
const LOCAL_SETTINGS_FILENAME = 'settings.local.json';

/**
 * `<scopeRoot>/.skill-map/settings.json` — the canonical layered-config
 * file. Used by `kernel/config/loader.ts` to compose its user / project
 * walk.
 */
export function kernelSettingsPath(scopeRoot: string): string {
  return join(scopeRoot, KERNEL_SKILL_MAP_DIR, SETTINGS_FILENAME);
}

/**
 * `<scopeRoot>/.skill-map/settings.local.json` — the local-overrides
 * companion to `settings.json`. Used by the same loader walk.
 */
export function kernelLocalSettingsPath(scopeRoot: string): string {
  return join(scopeRoot, KERNEL_SKILL_MAP_DIR, LOCAL_SETTINGS_FILENAME);
}
