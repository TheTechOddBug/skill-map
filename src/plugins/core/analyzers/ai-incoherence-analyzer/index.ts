/**
 * Built-in probabilistic `ai-incoherence-analyzer` Analyzer (Step 11 wave 1,
 * third of the finder roster). Judges ONE node for internal incoherence:
 * dangling references, drifting terminology, steps out of order, or
 * sections assuming context the document never gave. Its judgments land
 * in `state_findings` as `type: 'incoherence'` rows (advisory, never
 * exit-code-bearing); read them with `sm findings`, in context with
 * `sm show`.
 *
 * Finders judge INDEPENDENTLY (user ruling, 2026-07-14): no
 * cross-sibling deferrals in any prompt. The operator picks which
 * finders run, so a borderline defect must stay visible under any
 * enabled subset; overlap across finders is supported coexistence.
 *
 * As a probabilistic Analyzer it carries NO `evaluate()` (the orchestrator
 * excludes finders from every scan-time phase): the kernel renders
 * `prompt.md` + the canonical preamble + the report contract into a
 * queued job (`sm jobs submit ai-incoherence-analyzer -n <node>`), an external
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
 *     `'incoherence'` so this finder can only emit its own judgment (any
 *     other slug fails the record as `report-invalid`).
 *
 * Ships `stability: 'stable'`: ENABLED by default; the operator can
 * disable it (`sm plugins disable core/ai-incoherence-analyzer`) to drop it
 * as a submit target.
 */

import type { IAnalyzer, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiIncoherenceAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: 'ai-incoherence-analyzer',
  pluginId: PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags gaps that make a file hard to follow: references to things never defined, terms used inconsistently, or steps out of order.',
  // Stable: enabled by default (the operator can disable it).
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL).
  probExpectedDurationSeconds: 60,
  // No precondition: coherence is a universal prose property, `--all`
  // fans out to every non-virtual node regardless of kind.
  // No `evaluate`: probabilistic analyzers have none by contract.
};
