/**
 * Built-in probabilistic `ai-prose-to-rules-action` Action, the fixer paired
 * with the `core/ai-prose-to-rules-analyzer` finder (Modelo B, user request
 * 2026-08-08). Resolves that finder's `prose-to-rules` findings by editing
 * the node file: each flagged prose span becomes the explicit checklist
 * its finding already extracted, one imperative per item, meaning
 * intact; the record path stamps each `resolved[]` entry onto the
 * finding it names.
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
 * GRADUATED to `stability: 'stable'` (enabled by default) on 2026-08-08
 * in lock-step with its finder, after the live playground pass converted
 * the throwaway fixture cleanly (every rule survived with its meaning
 * and inline conditions intact). Disable with
 * `sm plugins disable core/ai-prose-to-rules-action`.
 */

import type { IAction, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiProseToRulesAction: IBuiltInManifest<IAction> = {
  id: 'ai-prose-to-rules-action',
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Applies the proposed checklists a review found: rewrites the flagged paragraphs into explicit checklist items without changing what any rule says.',
  // Stable: enabled by default (graduated 2026-08-08 in lock-step with
  // its finder after the live playground pass).
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL); a
  // single-node fix pass on a mid-tier model.
  probExpectedDurationSeconds: 120,
  // Modelo B: this fixer resolves the findings core/ai-prose-to-rules-analyzer
  // emits. A non-empty `analyzerIds` is ALSO the fixer signal the submit
  // path gates on to inject the `## Findings to resolve` section.
  precondition: { analyzerIds: ['core/ai-prose-to-rules-analyzer'] },
  // No `invoke`: probabilistic Actions run OUTSIDE the process (claim +
  // record handover). No `project`: the fix is a queued job, not a
  // scan-time button.
};
