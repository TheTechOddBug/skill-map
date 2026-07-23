/**
 * Built-in probabilistic `ai-redundancy-analyzer` Analyzer, the FIRST real
 * finder built-in (Step 11 wave 1). Judges ONE node for internal
 * redundancy: repeated instructions, trivial rewordings, or sections
 * restating other sections. Its judgments land in `state_findings` as
 * `type: 'redundancy'` rows (advisory, never exit-code-bearing); read
 * them with `sm findings`, in context with `sm show`.
 *
 * As a probabilistic Analyzer it carries NO `evaluate()` (the orchestrator
 * excludes finders from every scan-time phase): the kernel renders
 * `prompt.md` + the canonical preamble + the report contract into a
 * queued job (`sm jobs submit ai-redundancy-analyzer -n <node>`), an external
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
 *     `'redundancy'` so this finder can only emit its own judgment (any
 *     other slug fails the record as `report-invalid`).
 *
 * Built-ins bundle into `src/plugins/built-ins.ts` with no source
 * directory at runtime, so the built-ins codegen
 * (`scripts/generate-built-ins.js`) inlines both siblings onto the
 * emitted manifest as `promptTemplate` + `reportSchema` (this analyzer
 * is the first user of the analyzer-side inlining lane).
 *
 * Ships `stability: 'stable'`: ENABLED by default; the operator can
 * disable it (`sm plugins disable core/ai-redundancy-analyzer`) to drop it
 * as a submit target.
 */

import type { IAnalyzer, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiRedundancyAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: 'ai-redundancy-analyzer',
  pluginId: PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags repetition in a file: the same instruction, fact, or section stated more than once, so you can keep it in one place.',
  // Stable: enabled by default (the operator can disable it).
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL); a
  // single-node redundancy pass is a light judgment on a mid-tier model.
  probExpectedDurationSeconds: 60,
  // No precondition: redundancy is a universal prose property, `--all`
  // fans out to every non-virtual node regardless of kind.
  // No `evaluate`: probabilistic analyzers have none by contract.
};
