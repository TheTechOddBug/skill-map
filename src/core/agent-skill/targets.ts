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
import type { IProvider } from '../../kernel/extensions/index.js';
import { builtIns } from '../../plugins/built-ins.js';

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
    ...(scaffold.marker !== undefined ? { marker: scaffold.marker } : {}),
    aka: scaffold.aka ?? [],
  };
}

/**
 * Catalog rows in built-in order (vendor providers first per the
 * codegen `PLUGIN_ORDER`, so `claude` leads). The consumers are
 * pre-bootstrap helpers (`sm tutorial`, `sm agent`), so this reads the
 * built-in catalog directly rather than project config. The
 * default-offered rows are the book-ready destinations that declare a
 * `scaffold.skillDir` and ship enabled: `claude` (rich track), the
 * beta `codex` (rich track), and the open-standard `agent-skills`
 * (basic track). `beta` ships enabled, so `codex` appears by default;
 * `--experimental` would add any `stability: experimental` scaffolder,
 * of which there is none today (they ship disabled), so the flag is a
 * no-op among current built-ins.
 */
export function listScaffoldTargets(includeExperimental = false): IScaffoldTarget[] {
  const out: IScaffoldTarget[] = [];
  for (const provider of builtIns().providers) {
    const target = toScaffoldTarget(provider, includeExperimental);
    if (target !== null) out.push(target);
  }
  return out;
}
