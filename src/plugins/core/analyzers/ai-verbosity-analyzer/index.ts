/**
 * Built-in probabilistic `ai-verbosity-analyzer` Analyzer, one of the five
 * OPTIMIZATION finders (2026-07-22, user decision: the monolithic
 * `skill-optimizer` capability decomposed into topic finder / fixer
 * pairs). Judges ONE node for verbosity (token economy). Its judgments land in
 * `state_findings` as `type: 'verbosity'` rows (advisory, never
 * exit-code-bearing); read them with `sm findings`, in context with
 * `sm show`.
 *
 * As a probabilistic Analyzer it carries NO `evaluate()` (the
 * orchestrator excludes finders from every scan-time phase): the kernel
 * renders `prompt.md` + the canonical preamble + the report contract
 * into a queued job, an external agent processes it (`sm jobs claim`),
 * and `sm record` validates the JSON report against `report.schema.json`
 * before writing the findings through (`spec/job-lifecycle.md` §Record).
 *
 * Structure-as-truth siblings (`prompt.md` + `report.schema.json`) are
 * inlined onto the emitted manifest by the built-ins codegen. The report
 * schema `$ref`s the canonical findings envelope (the finder routing
 * signal) and narrows `findings[].type` to the const `'verbosity'`.
 *
 * Ships `stability: 'stable'`: ENABLED by default (graduated
 * 2026-07-22, the first of the five optimization pairs to prove its
 * prompt in the live playground); the operator can disable it with
 * `sm plugins disable core/ai-verbosity-analyzer`.
 */

import type { IAnalyzer, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiVerbosityAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: 'ai-verbosity-analyzer',
  pluginId: PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags wording that adds length but not meaning: filler phrases, empty hedging, over-explaining the obvious, so the file reads faster and costs fewer tokens. Careful: the fix can lose information, review its edits.',
  // Stable: enabled by default (graduated 2026-07-22 after the live
  // playground test; the operator can disable it).
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL); a
  // single-node judgment is a light pass on a mid-tier model.
  probExpectedDurationSeconds: 60,
  // No precondition: the prompt scopes itself (a node with nothing to
  // judge on this axis returns an empty findings array), so `--all`
  // fans out to every non-virtual node regardless of kind.
  // No `evaluate`: probabilistic analyzers have none by contract.
};
