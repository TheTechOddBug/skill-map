/**
 * Built-in probabilistic `node-clarify` Action, a fixer for the
 * `core/node-incoherence` finder (`spec/architecture.md` §Analyzer ↔ Action
 * relationship (Modelo B), `spec/job-lifecycle.md` §Findings injection for
 * fixers). A fixer is a probabilistic Action that declares
 * `precondition.analyzerIds`: it resolves the findings a finder emitted.
 * `node-clarify` resolves `core/node-incoherence` findings by editing the
 * node file to fix dangling references, align drifting terminology, and
 * supply missing context, without inventing facts.
 *
 * As a probabilistic Action it carries NO in-process `invoke` and NO
 * scan-time `project`: the kernel renders `prompt.md` + the canonical
 * preamble + the injected findings section (this node's
 * `core/node-incoherence` findings, stale ones flagged for the agent to
 * verify against the body) + the report contract into a queued job
 * (`sm job submit node-clarify -n <node>`), an external agent drains it
 * (`sm job claim`), performs the file edit with its own tools, and `sm
 * record` validates the JSON report against `report.schema.json`. skill-map
 * NEVER writes the node body; the next scan picks up the edit and the
 * resolved findings go stale via the body-hash rule (`spec/architecture.md`
 * §IO discipline).
 *
 * **Structure-as-truth siblings.** Two files next to this manifest:
 *   - `prompt.md`, the prompt template (single `{{userContent}}`
 *     placeholder; the literal `<user-content` delimiter is deliberately
 *     avoided in the prose so the render's delimiter guard does not trip).
 *   - `report.schema.json`, the report contract. It `$ref`s
 *     `report-base.schema.json` directly (NOT the `findings/` envelope, a
 *     fixer is not a finder): the report is execution-only, recording per
 *     finding whether the clarification was applied plus an edits summary.
 *
 * Built-ins bundle into `src/plugins/built-ins.ts` with no source directory
 * at runtime, so the built-ins codegen (`scripts/generate-built-ins.js`)
 * inlines both siblings onto the emitted manifest as `promptTemplate` +
 * `reportSchema`.
 *
 * Ships `stability: 'experimental'`: DISABLED by default, the operator opts
 * in (`sm plugins enable core/node-clarify`) before the fixer resolves as a
 * submit target.
 */

import type { IAction, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const nodeClarifyAction: IBuiltInManifest<IAction> = {
  id: 'node-clarify',
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Probabilistic fixer that resolves core/node-incoherence findings by editing the node file to fix dangling references, align drifting terminology, and supply missing context. The draining agent performs the edit; skill-map never writes the body.',
  // Experimental: disabled by default, the operator opts in.
  stability: 'experimental',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL); a
  // single-node clarification edit is a light pass on a mid-tier model.
  probExpectedDurationSeconds: 120,
  // Modelo B: this fixer resolves the findings core/node-incoherence emits.
  // A non-empty `analyzerIds` is ALSO the fixer signal the submit path gates
  // on to inject the `## Findings to resolve` section.
  precondition: { analyzerIds: ['core/node-incoherence'] },
  // No `invoke`: probabilistic Actions run OUTSIDE the process (claim +
  // record handover). No `project`: the fix is a queued job, not a
  // scan-time button.
};
