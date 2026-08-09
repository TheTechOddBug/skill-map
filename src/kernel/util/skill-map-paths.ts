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

import { dirname, join, resolve } from 'node:path';

/**
 * Per-scope directory the kernel + CLI both store state under (DB file,
 * settings, plugins, etc.). The single canonical source for the literal;
 * `core/paths/db-path.ts` re-exports it.
 */
export const SKILL_MAP_DIR = '.skill-map';

/** Historic kernel-side alias for {@link SKILL_MAP_DIR}. */
export const KERNEL_SKILL_MAP_DIR = SKILL_MAP_DIR;

/**
 * Subdirectory beside the DB file that holds DB backups: both the
 * automatic pre-migration snapshots (`skill-map-pre-migrate-v<N>.db`,
 * written by the migrations runner before it applies a schema migration)
 * and the manual `sm db backup` output (`<timestamp>.db`). Single
 * canonical source for the `backups` segment; the `core/paths/db-path.ts`
 * re-export feeds the CLI so neither side composes the literal by hand.
 */
export const BACKUPS_DIRNAME = 'backups';

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

/**
 * `<dbDir>/backups` for a given DB file path. Derived from the DB file's
 * OWN directory (not a fixed `.skill-map/`) so a `--db <path>` override
 * keeps its backups beside it. Consumed by the kernel migrations runner
 * and, via the `core/paths` re-export, by `sm db backup`, so the `backups`
 * segment lives in exactly one place.
 */
export function kernelBackupsDir(dbPath: string): string {
  return join(dirname(resolve(dbPath)), BACKUPS_DIRNAME);
}

/**
 * `<scopeRoot>/.skill-map/.agents/skills`, the skill-action catalog
 * folder (`spec/skill-actions.md` §The catalog folder). The inner
 * `.agents/skills/` segment is the generic store the `npx skills`
 * installer emits, so installing is one command run with the working
 * directory inside `.skill-map/`. This is the ONLY folder skill-action
 * discovery walks (`core/skill-actions/catalog.ts`); the `core/paths`
 * re-export feeds the host layers so the segments live in one place.
 */
export function kernelSkillActionsDir(scopeRoot: string): string {
  return join(scopeRoot, KERNEL_SKILL_MAP_DIR, '.agents', 'skills');
}
