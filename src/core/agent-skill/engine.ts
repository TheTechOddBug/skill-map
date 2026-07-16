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

import {
  PROCESS_JOBS_SKILL_CONTENT,
  PROCESS_JOBS_SKILL_DIR,
  PROCESS_JOBS_SKILL_FILE,
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

/** Absolute `SKILL.md` path inside the skill folder. */
export function agentSkillFile(cwd: string, skillDir: string): string {
  return join(agentSkillFolder(cwd, skillDir), PROCESS_JOBS_SKILL_FILE);
}

/**
 * Materialise the canonical skill. Three-state outcome: fresh install,
 * update (bytes differ from the canonical template, an older CLI's
 * copy) rewritten verbatim, or already up to date (identical bytes,
 * nothing written). Also drops the lens `marker` directory when the
 * Provider declares one (shared `.agents/skills` territory). Throws on
 * IO failure; callers own the error surface.
 */
export function installAgentSkill(
  cwd: string,
  skillDir: string,
  marker?: string,
): TInstallOutcome {
  const file = agentSkillFile(cwd, skillDir);
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const outcome: TInstallOutcome =
    existing === null ? 'installed' : existing === PROCESS_JOBS_SKILL_CONTENT ? 'up-to-date' : 'updated';
  if (outcome !== 'up-to-date') {
    mkdirSync(agentSkillFolder(cwd, skillDir), { recursive: true });
    writeFileSync(file, PROCESS_JOBS_SKILL_CONTENT);
  }
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
 * Read-only install probe. `stale` = the materialised bytes differ
 * from the canonical constant (older CLI install or manual edit), the
 * same comparison `installAgentSkill` reports as `updated`.
 */
export function agentSkillStatus(cwd: string, skillDir: string): IAgentSkillStatus {
  const file = agentSkillFile(cwd, skillDir);
  const installed = existsSync(file);
  const stale = installed && readFileSync(file, 'utf8') !== PROCESS_JOBS_SKILL_CONTENT;
  return { installed, stale };
}
