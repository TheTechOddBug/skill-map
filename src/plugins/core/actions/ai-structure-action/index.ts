/**
 * Built-in probabilistic `ai-structure-action` Action, the fixer paired with
 * the `core/ai-structure-analyzer` finder (Modelo B, one of the five
 * OPTIMIZATION pairs, 2026-07-22). Resolves that finder's `structure`
 * findings by editing the node file; the record path stamps each
 * `resolved[]` entry onto the finding it names.
 *
 * As a probabilistic Action it carries NO in-process `invoke` and NO
 * scan-time `project`: the kernel renders `prompt.md` + the canonical
 * preamble + the injected `## Findings to resolve` section + the report
 * contract into a queued job, an external agent processes it and
 * performs the file edit with its own tools, and `sm record` validates
 * the JSON report against `report.schema.json`. skill-map NEVER writes
 * the node body.
 *
 * Structure-as-truth siblings (`prompt.md` + `report.schema.json`) are
 * inlined onto the emitted manifest by the built-ins codegen.
 *
 * Ships `stability: 'stable'`: ENABLED by default (graduated
 * 2026-07-22 in lock-step with its finder: the live fix reordered and
 * re-leveled without losing a sentence); disable with
 * `sm plugins disable core/ai-structure-action`.
 */

import type { IAction, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiStructureAction: IBuiltInManifest<IAction> = {
  id: 'ai-structure-action',
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Fixes the layout problems a review found: moves and regroups the flagged content so the important rules lead, without changing what anything says.',
  // Stable: enabled by default (graduated 2026-07-22 after the live
  // playground test; the operator can disable it).
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL); a
  // single-node fix pass on a mid-tier model.
  probExpectedDurationSeconds: 120,
  // Modelo B: this fixer resolves the findings core/ai-structure-analyzer
  // emits. A non-empty `analyzerIds` is ALSO the fixer signal the submit
  // path gates on to inject the `## Findings to resolve` section.
  precondition: { analyzerIds: ['core/ai-structure-analyzer'] },
  // No `invoke`: probabilistic Actions run OUTSIDE the process (claim +
  // record handover). No `project`: the fix is a queued job, not a
  // scan-time button.
};
