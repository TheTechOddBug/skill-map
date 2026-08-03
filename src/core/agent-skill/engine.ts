/**
 * Shared engine behind the `sm agent install / uninstall / status` verb
 * family AND the BFF's `/api/agent/install` surface (the Settings →
 * Project button), mirroring how `core/activity/install.ts` backs both
 * faces of the activity-hooks install. Pure filesystem operations on
 * plain strings (`skillDir` / `marker` come from the caller's resolved
 * `IProviderScaffold`), so `core/` stays decoupled from the CLI's
 * target-selection types.
 *
 * The three-state install outcome and the byte-exact staleness probe
 * share the same comparison against the canonical template, so the CLI
 * wording (installed / updated / already up to date), the `status`
 * verb's `stale` field, and the UI button states (Install / Update /
 * Up to date) can never disagree.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ensureGeneratedFolderGitignore } from '../generated-folder-gitignore.js';
import {
  PROCESS_JOBS_SKILL_DIR,
  PROCESS_JOBS_SKILL_FILE,
  PROCESS_JOBS_SKILL_FILES,
} from './skill-template.js';

/** Outcome of `installAgentSkill` (see the module header). */
export type TInstallOutcome = 'installed' | 'updated' | 'up-to-date';

/** Result of `agentSkillStatus`; `stale` is false when not installed. */
export interface IAgentSkillStatus {
  installed: boolean;
  stale: boolean;
}

/** Absolute skill folder under the lens's `scaffold.skillDir`. */
export function agentSkillFolder(cwd: string, skillDir: string): string {
  return join(cwd, skillDir, PROCESS_JOBS_SKILL_DIR);
}

/** Absolute `SKILL.md` (entry file + install marker) inside the folder. */
export function agentSkillFile(cwd: string, skillDir: string): string {
  return join(agentSkillFolder(cwd, skillDir), PROCESS_JOBS_SKILL_FILE);
}

/**
 * True when EVERY materialised skill file exists in `folder` with bytes
 * identical to the canonical template. The install / status contract is
 * atomic over the set: a single missing or drifted file (an older CLI
 * that shipped only `SKILL.md`, a manual edit) makes the whole skill
 * `stale` / `updated`.
 */
function allSkillFilesMatch(folder: string): boolean {
  return PROCESS_JOBS_SKILL_FILES.every((f) => {
    const path = join(folder, f.path);
    return existsSync(path) && readFileSync(path, 'utf8') === f.content;
  });
}

/**
 * Materialise the canonical skill folder. Three-state outcome: fresh
 * install (the entry file was absent), update (any file differs from or
 * is missing against the canonical set, an older CLI's copy) rewritten
 * verbatim, or already up to date (every file identical, nothing
 * written). Also drops the lens `marker` directory when the Provider
 * declares one (shared `.agents/skills` territory). Throws on IO
 * failure; callers own the error surface.
 */
export function installAgentSkill(
  cwd: string,
  skillDir: string,
  marker?: string,
): TInstallOutcome {
  const folder = agentSkillFolder(cwd, skillDir);
  const entryExists = existsSync(agentSkillFile(cwd, skillDir));
  const outcome: TInstallOutcome = !entryExists
    ? 'installed'
    : allSkillFilesMatch(folder)
      ? 'up-to-date'
      : 'updated';
  if (outcome !== 'up-to-date') {
    mkdirSync(folder, { recursive: true });
    for (const f of PROCESS_JOBS_SKILL_FILES) {
      writeFileSync(join(folder, f.path), f.content);
    }
  }
  // Fresh install only: keep the generated copy out of commits
  // (spec/cli-contract.md §Scope ignore file → Materialised skill
  // folders). Never on an update, the operator may have removed the
  // ignore file on purpose to commit the folder. Best-effort by
  // contract, and deliberately outside the canonical file set so
  // deleting it never reads as a stale install.
  if (outcome === 'installed') ensureGeneratedFolderGitignore(folder);
  if (marker !== undefined) {
    mkdirSync(join(cwd, marker), { recursive: true });
  }
  return outcome;
}

/**
 * Remove the materialised skill folder. Returns `false` when nothing
 * was installed (idempotent no-op), `true` when the folder was removed.
 * Throws on IO failure.
 */
export function uninstallAgentSkill(cwd: string, skillDir: string): boolean {
  const folder = agentSkillFolder(cwd, skillDir);
  if (!existsSync(folder)) return false;
  rmSync(folder, { recursive: true, force: true });
  return true;
}

/**
 * Read-only install probe. `installed` tracks the entry file; `stale` =
 * any materialised file differs from or is missing against the canonical
 * set (older CLI install, partial copy, or manual edit), the same
 * comparison `installAgentSkill` reports as `updated`.
 */
export function agentSkillStatus(cwd: string, skillDir: string): IAgentSkillStatus {
  const installed = existsSync(agentSkillFile(cwd, skillDir));
  const stale = installed && !allSkillFilesMatch(agentSkillFolder(cwd, skillDir));
  return { installed, stale };
}
