/**
 * Built-in probabilistic `ai-contradiction-analyzer` Analyzer (Step 11 wave 1,
 * second of the finder roster). Judges ONE node for internal
 * contradictions: directive or statement pairs that clash, either
 * because they cannot both be followed or be true at once (mutual
 * exclusion) or because following both is risky or counterproductive
 * (a harmful combination, the drug-interaction shape). Its judgments
 * land in `state_findings` as `type: 'contradiction'` rows (advisory,
 * never exit-code-bearing); read them with `sm findings`, in context
 * with `sm show`.
 *
 * Finders judge INDEPENDENTLY (user ruling, 2026-07-14): no
 * cross-sibling deferrals in any prompt. The operator picks which
 * finders run, so a borderline defect must stay visible under any
 * enabled subset; overlap across finders is supported coexistence.
 *
 * As a probabilistic Analyzer it carries NO `evaluate()` (the orchestrator
 * excludes finders from every scan-time phase): the kernel renders
 * `prompt.md` + the canonical preamble + the report contract into a
 * queued job (`sm jobs submit ai-contradiction-analyzer -n <node>`), an external
 * agent processes it (`sm jobs claim`), and `sm record` validates the JSON
 * report against `report.schema.json` before writing the findings
 * through (`spec/job-lifecycle.md` §Record).
 *
 * **Structure-as-truth siblings.** Two files next to this manifest:
 *   - `prompt.md`, the prompt template (single `{{userContent}}`
 *     placeholder; user-approved wording, 2026-07-14).
 *   - `report.schema.json`, the report contract. It `$ref`s the canonical
 *     findings envelope (`findings/report.schema.json`), the finder
 *     routing signal, and narrows `findings[].type` to the const
 *     `'contradiction'` so this finder can only emit its own judgment
 *     (any other slug fails the record as `report-invalid`).
 *
 * Ships `stability: 'stable'`: ENABLED by default; the operator can
 * disable it (`sm plugins disable core/ai-contradiction-analyzer`) to drop
 * it as a submit target.
 */

import type { IAnalyzer, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiContradictionAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: 'ai-contradiction-analyzer',
  pluginId: PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags instructions in a file that work against each other: two that cannot both be followed, or two that are risky to combine.',
  // Stable: enabled by default (the operator can disable it).
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL).
  probExpectedDurationSeconds: 60,
  // No precondition: contradiction is a universal prose property, `--all`
  // fans out to every non-virtual node regardless of kind.
  // No `evaluate`: probabilistic analyzers have none by contract.
};
