/**
 * Built-in probabilistic `ai-redundancy-action` Action, the FIRST fixer
 * (`spec/architecture.md` §Analyzer ↔ Action relationship (Modelo B),
 * `spec/job-lifecycle.md` §Findings injection for fixers). A fixer is a
 * probabilistic Action that declares `precondition.analyzerIds`: it
 * resolves the findings a finder emitted. `ai-redundancy-action` resolves
 * `core/ai-redundancy-analyzer` findings by editing the node file to collapse
 * repetition into single statements, preserving all meaning.
 *
 * As a probabilistic Action it carries NO in-process `invoke` and NO
 * scan-time `project`: the kernel renders `prompt.md` + the canonical
 * preamble + the injected `## Findings to resolve` section (this node's
 * `core/ai-redundancy-analyzer` findings, stale ones flagged for the agent to
 * verify against the body) + the report contract
 * into a queued job (`sm jobs submit ai-redundancy-action -n <node>`), an
 * external agent processes it (`sm jobs claim`), performs the file edit with
 * its own tools, and `sm record` validates the JSON report against
 * `report.schema.json`. skill-map NEVER writes the node body; the next scan
 * picks up the edit and the resolved findings go stale via the body-hash
 * rule (`spec/architecture.md` §IO discipline).
 *
 * **Structure-as-truth siblings.** Two files next to this manifest:
 *   - `prompt.md`, the prompt template (single `{{userContent}}`
 *     placeholder; the literal `<user-content` delimiter is deliberately
 *     avoided in the prose so the render's delimiter guard does not trip).
 *   - `report.schema.json`, the report contract. It `$ref`s
 *     `report-base.schema.json` directly (NOT the `findings/` envelope, a
 *     fixer is not a finder): the report is execution-only, recording per
 *     finding whether the consolidation was applied plus an edits summary.
 *
 * Built-ins bundle into `src/plugins/built-ins.ts` with no source directory
 * at runtime, so the built-ins codegen (`scripts/generate-built-ins.js`)
 * inlines both siblings onto the emitted manifest as `promptTemplate` +
 * `reportSchema`.
 *
 * Ships `stability: 'stable'`: ENABLED by default; the operator can disable
 * it (`sm plugins disable core/ai-redundancy-action`) to drop it as a submit
 * target.
 */

import type { IAction, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiRedundancyAction: IBuiltInManifest<IAction> = {
  id: 'ai-redundancy-action',
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Fixes the repetition a review found: collapses each repeated instruction, fact, or section into one place, keeping every distinct detail.',
  // Stable: enabled by default (the operator can disable it).
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL); a
  // single-node consolidation edit is a light pass on a mid-tier model.
  probExpectedDurationSeconds: 120,
  // Modelo B: this fixer resolves the findings core/ai-redundancy-analyzer emits.
  // A non-empty `analyzerIds` is ALSO the fixer signal the submit path gates
  // on to inject the `## Findings to resolve` section.
  precondition: { analyzerIds: ['core/ai-redundancy-analyzer'] },
  // No `invoke`: probabilistic Actions run OUTSIDE the process (claim +
  // record handover). No `project`: the fix is a queued job, not a
  // scan-time button.
};
