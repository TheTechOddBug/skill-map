/**
 * Built-in probabilistic `ai-prose-to-rules-analyzer` Analyzer (user request
 * 2026-08-08). Judges ONE node for enumerable rules buried in prose:
 * spans where two or more normative directives (must / never / always /
 * before-X-do-Y) sit inside narrative paragraphs a consuming agent is
 * likely to gloss over, and proposes the explicit checklist form. The
 * finding's `detail` carries the extracted checklist itself, one
 * imperative per line, so the proposal is ready to paste even before the
 * paired fixer runs. Its judgments land in `state_findings` as
 * `type: 'prose-to-rules'` rows (advisory, never exit-code-bearing); read
 * them with `sm findings`, in context with `sm show`.
 *
 * Axis boundary (user decision 2026-08-08): this finder judges what a
 * span ENCODES (enumerable normative content), never where it sits or
 * how the document is organized; `core/ai-structure-analyzer` ceded the
 * prose-should-be-a-list territory to this finder in the same revision,
 * keeping its own axis at placement and hierarchy. Neither prompt names
 * the other (finders judge INDEPENDENTLY, user ruling 2026-07-14: no
 * cross-sibling deferrals; each defines its axis in positive terms).
 *
 * As a probabilistic Analyzer it carries NO `evaluate()` (the orchestrator
 * excludes finders from every scan-time phase): the kernel renders
 * `prompt.md` + the canonical preamble + the report contract into a
 * queued job (`sm jobs submit ai-prose-to-rules-analyzer -n <node>`), an
 * external agent processes it (`sm jobs claim`), and `sm record`
 * validates the JSON report against `report.schema.json` before writing
 * the findings through (`spec/job-lifecycle.md` §Record).
 *
 * **Structure-as-truth siblings.** Two files next to this manifest:
 *   - `prompt.md`, the prompt template (single `{{userContent}}`
 *     placeholder).
 *   - `report.schema.json`, the report contract. It `$ref`s the canonical
 *     findings envelope (`findings/report.schema.json`), the finder
 *     routing signal, and narrows `findings[].type` to the const
 *     `'prose-to-rules'` so this finder can only emit its own judgment
 *     (any other slug fails the record as `report-invalid`).
 *
 * GRADUATED to `stability: 'stable'` (enabled by default) on 2026-08-08
 * after its live playground pass: the throwaway fixture's buried-rules
 * paragraph came back as a faithful 8-item checklist (rationale kept as
 * parentheticals, the narrative control section untouched). Disable with
 * `sm plugins disable core/ai-prose-to-rules-analyzer`.
 */

import type { IAnalyzer, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiProseToRulesAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: 'ai-prose-to-rules-analyzer',
  pluginId: PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Finds rules buried inside paragraphs (musts, nevers, step orders) and proposes them as an explicit checklist, extracted and ready to paste.',
  // Stable: enabled by default (graduated 2026-08-08 after the live
  // playground pass; the operator can disable it).
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL).
  probExpectedDurationSeconds: 60,
  // No precondition: rules hide in prose regardless of node kind, `--all`
  // fans out to every non-virtual node.
  // No `evaluate`: probabilistic analyzers have none by contract.
};
