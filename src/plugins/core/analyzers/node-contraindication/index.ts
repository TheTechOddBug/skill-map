/**
 * Built-in probabilistic `node-contraindication` Analyzer (Step 11
 * wave 1, fourth of the finder roster). Judges ONE node for
 * contraindications: directive pairs that are individually valid but
 * jointly risky or counterproductive (the drug-interaction shape). Its
 * judgments land in `state_findings` as `type: 'contraindication'` rows
 * (advisory, never exit-code-bearing); read them with `sm findings`, in
 * context with `sm show`.
 *
 * Finders judge INDEPENDENTLY (user ruling, 2026-07-14): no
 * cross-sibling deferrals in any prompt. The operator picks which
 * finders run, so a borderline defect must stay visible under any
 * enabled subset; overlap across finders is supported coexistence.
 *
 * As a probabilistic Analyzer it carries NO `evaluate()` (the orchestrator
 * excludes finders from every scan-time phase): the kernel renders
 * `prompt.md` + the canonical preamble + the report contract into a
 * queued job (`sm jobs submit node-contraindication -n <node>`), an
 * external agent processes it (`sm jobs claim`), and `sm record` validates
 * the JSON report against `report.schema.json` before writing the
 * findings through (`spec/job-lifecycle.md` §Record).
 *
 * **Structure-as-truth siblings.** Two files next to this manifest:
 *   - `prompt.md`, the prompt template (single `{{userContent}}`
 *     placeholder; user-approved wording, 2026-07-14).
 *   - `report.schema.json`, the report contract. It `$ref`s the canonical
 *     findings envelope (`findings/report.schema.json`), the finder
 *     routing signal, and narrows `findings[].type` to the const
 *     `'contraindication'` so this finder can only emit its own judgment
 *     (any other slug fails the record as `report-invalid`).
 *
 * Ships `stability: 'experimental'`: DISABLED by default, the operator
 * opts in (`sm plugins enable core/node-contraindication`) before the
 * finder resolves as a submit target.
 */

import type { IAnalyzer, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const nodeContraindicationAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: 'node-contraindication',
  pluginId: PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Probabilistic finder that judges a single node for contraindications: directive pairs that are individually valid but jointly risky or counterproductive. Emits findings of type contraindication; advisory, never affects exit codes.',
  // Experimental: disabled by default, the operator opts in.
  stability: 'experimental',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL).
  probExpectedDurationSeconds: 60,
  // No precondition: directive interaction is a universal prose
  // property, `--all` fans out to every non-virtual node regardless of
  // kind.
  // No `evaluate`: probabilistic analyzers have none by contract.
};
