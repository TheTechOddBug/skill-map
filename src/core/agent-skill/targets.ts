/**
 * Scaffold-destination catalog: which Providers can receive a
 * materialised skill folder, and where. One row per Provider that
 * declares a `scaffold.skillDir`; shared by `sm tutorial` (the
 * destination prompt), the `sm agent` verb family (install / uninstall
 * / status), and the BFF's `/api/agent/install` surface, so the three
 * faces can never fork their selection semantics.
 *
 * Lives in `core/` (not `cli/commands/tutorial.ts`, its historical
 * home) because the BFF consumes it too and `src/server/` never
 * imports from `src/cli/`. The sibling `engine.ts` stays on plain
 * strings (`skillDir` / `marker`); this module owns the
 * Provider → target projection that produces them.
 */

import { installedDefaultEnabled } from '../../kernel/config/plugin-resolver.js';
import type { IProvider, IProviderScaffold } from '../../kernel/extensions/index.js';
import { builtIns } from '../../plugins/built-ins.js';

import { agentSkillStatus } from './engine.js';

/**
 * One scaffold destination, projected from a Provider that declares a
 * `scaffold.skillDir`. `id` is what `--for` (and the HTTP `provider`
 * param) matches; `label` is the human name; `skillDir` is the
 * territory the skill folder lands under; `aka` lists the other agents
 * that consume this territory (display-only).
 */
export interface IScaffoldTarget {
  id: string;
  label: string;
  skillDir: string;
  /** Marker dir to create alongside the skill so the chosen lens resolves. */
  marker?: string;
  aka: readonly string[];
  /**
   * Owner of a SHARED `skillDir` (`IProviderScaffold.sharedWith`), set on the
   * lenses that read a territory they do not own (`antigravity` / `opencode`
   * over the open `.agents/skills`). Present = this row is a per-lens
   * resolution target, NOT a destination choice: `listScaffoldDestinations`
   * filters it out so one territory stays one row in the `sm tutorial`
   * prompt, while `sm agent` / the BFF keep resolving it.
   */
  sharedWith?: string;
}

/**
 * Project one Provider into a scaffold target, or `null` when it is
 * not a scaffold destination. A Provider qualifies when it declares a
 * `scaffold.skillDir` (e.g. `claude`, `agent-skills`); the universal
 * `markdown` fallback declares none, so it is skipped. Experimental
 * Providers (`stability: experimental`, ships disabled) are only
 * included when `includeExperimental` is set (the `--experimental`
 * flag); by default they are omitted so consumers offer only ready
 * destinations.
 */
export function toScaffoldTarget(
  provider: IProvider,
  includeExperimental = false,
): IScaffoldTarget | null {
  const scaffold = provider.scaffold;
  if (!scaffold || !scaffold.skillDir) return null;
  if (!installedDefaultEnabled(provider.stability) && !includeExperimental) return null;
  return {
    id: provider.id,
    label: provider.presentation.label,
    skillDir: scaffold.skillDir,
    aka: scaffold.aka ?? [],
    ...optionalScaffoldFields(scaffold),
  };
}

/**
 * The optional passthroughs, copied only when declared so the projection
 * stays `exactOptionalPropertyTypes`-safe (and `toScaffoldTarget` stays
 * under the complexity budget).
 */
function optionalScaffoldFields(scaffold: IProviderScaffold): Partial<IScaffoldTarget> {
  const out: Partial<IScaffoldTarget> = {};
  if (scaffold.marker !== undefined) out.marker = scaffold.marker;
  if (scaffold.sharedWith !== undefined) out.sharedWith = scaffold.sharedWith;
  return out;
}

/**
 * Catalog rows in the order the caller supplies (for the composed
 * runtime that is built-in order first, vendor providers leading per the
 * codegen `PLUGIN_ORDER`, then project-local plugins).
 *
 * `providers` is a REQUIRED argument on purpose. It used to read
 * `builtIns()` directly, described as fine because "the consumers are
 * pre-bootstrap helpers", and that is what made a project-local drop-in
 * Provider invisible to the whole family: `sm agent install` refused with
 * "the active lens declares no skill directory" for a lens whose manifest
 * declared `scaffold.skillDir` perfectly well, simply because it was not
 * a built-in. Callers that genuinely run before any plugin is loaded
 * (`sm tutorial`, which materialises into an EMPTY folder) pass
 * `builtIns().providers` explicitly, which states the limitation instead
 * of hiding it.
 *
 * The default-offered rows are the destinations that declare a
 * `scaffold.skillDir` and ship enabled. `beta` ships enabled, so `codex`
 * appears by default; `--experimental` adds any `stability: experimental`
 * scaffolder.
 */
export function listScaffoldTargets(
  providers: readonly IProvider[],
  includeExperimental = false,
): IScaffoldTarget[] {
  const out: IScaffoldTarget[] = [];
  for (const provider of providers) {
    const target = toScaffoldTarget(provider, includeExperimental);
    if (target !== null) out.push(target);
  }
  return out;
}

/**
 * The subset a verb that offers a DESTINATION CHOICE should list: rows that
 * OWN their `skillDir`. A lens sharing another's territory (`sharedWith`,
 * e.g. `antigravity` / `opencode` over the open `.agents/skills`) is a valid
 * per-lens resolution target but NOT a separate destination, so one territory
 * keeps producing one prompt row. `sm tutorial` uses this; `sm agent` and the
 * BFF's per-lens probe keep using the full `listScaffoldTargets` catalog.
 */
export function listScaffoldDestinations(
  providers: readonly IProvider[],
  includeExperimental = false,
): IScaffoldTarget[] {
  return listScaffoldTargets(providers, includeExperimental).filter(
    (t) => t.sharedWith === undefined,
  );
}

/**
 * Project-wide presence of the processing skill, the probe behind the
 * `sm jobs submit` processing-agent gate (`spec/job-lifecycle.md` §Submit):
 * `installed` = the skill artifact exists under AT LEAST ONE scaffold
 * destination (experimental Providers included, the probe is read-only and
 * a physically present skill is readable by an agent regardless of the
 * Provider's stability); `fresh` = at least one installed copy carries the
 * canonical bytes of THIS CLI (the same byte-exact comparison as
 * `sm agent status`). Installed-but-not-fresh drives the refresh advisory,
 * not a refusal. Shared `skillDir` territories (`.agents/skills`) are
 * probed once.
 */
export interface IProcessingSkillPresence {
  installed: boolean;
  fresh: boolean;
}

/**
 * See {@link IProcessingSkillPresence}. `providers` defaults to the
 * built-ins: this probe only reads DIRECTORIES off disk, and every
 * project-local Provider's territory is either one a built-in already
 * declares (the shared `.agents/skills`) or one it owns alone, in which
 * case the caller passes the composed set to have it probed too.
 */
export function processingSkillPresence(
  cwd: string,
  providers: readonly IProvider[] = builtIns().providers,
): IProcessingSkillPresence {
  const dirs = new Set(listScaffoldTargets(providers, true).map((t) => t.skillDir));
  const statuses = [...dirs].map((dir) => agentSkillStatus(cwd, dir));
  return {
    installed: statuses.some((s) => s.installed),
    fresh: statuses.some((s) => s.installed && !s.stale),
  };
}
