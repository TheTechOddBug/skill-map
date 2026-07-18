/**
 * Built-in probabilistic `ai-reference-action` Action, a fixer for the
 * DETERMINISTIC `core/reference-broken` analyzer (`spec/architecture.md`
 * §Analyzer ↔ Action relationship (Modelo B) covers BOTH analyzer modes:
 * for a deterministic analyzer the trigger is its `Issue` rows
 * (`scan_issues`), for a probabilistic finder it is its `state_findings`
 * rows). `ai-reference-action` resolves `core/reference-broken` Issues by
 * editing the node file to repoint each broken reference link at the target
 * it was meant to reach.
 *
 * Deterministic-analyzer fixer, so it is UNLIKE the finder-paired fixers in
 * two ways:
 *   - the submit path injects the node's `core/reference-broken` ISSUES
 *     (from `scan_issues`, via `selectFixerIssues` / `buildIssuesSection`)
 *     into a `## Issues to resolve` section, not `state_findings`; and
 *   - it is exempt from the `ai-<subject>-analyzer` / `ai-<subject>-action`
 *     pairing convention (that pairs probabilistic AI finders with their
 *     fixers; this fixer consumes a deterministic Rule and is named after
 *     what it fixes, references, not after its analyzer).
 *
 * As a probabilistic Action it carries NO in-process `invoke` and NO
 * scan-time `project`: the kernel renders `prompt.md` + the canonical
 * preamble + the injected `## Issues to resolve` section + the report
 * contract into a queued job (`sm jobs submit ai-reference-action -n
 * <node>`), an external agent processes it (`sm jobs claim`), performs the
 * file edit with its own tools, and `sm record` validates the JSON report
 * against `report.schema.json`. skill-map NEVER writes the node body; the
 * next scan re-derives the links and the repaired reference clears its
 * `reference-broken` Issue via the body-hash rule (`spec/architecture.md`
 * §IO discipline). There is no finding to stamp: an Issue has no stable id,
 * so the fix's evidence IS the next scan.
 *
 * **Project-scope boundary.** The agent may repoint a link only when the
 * intended target lives INSIDE the project scan roots. A target that only
 * resolves OUTSIDE the project is never searched on skill-map's initiative
 * (the `$HOME`-never invariant, `spec/cli-contract.md` §Scope is always
 * project-local): the prompt instructs the agent to set `human-decision`
 * and ask the operator for permission first.
 *
 * **Structure-as-truth siblings.** Two files next to this manifest:
 *   - `prompt.md`, the prompt template (single `{{userContent}}`
 *     placeholder; the literal `<user-content` delimiter is deliberately
 *     avoided in the prose so the render's delimiter guard does not trip).
 *   - `report.schema.json`, the report contract. It `$ref`s
 *     `report-base.schema.json` directly (NOT the `findings/` envelope, a
 *     fixer is not a finder): the report is execution-only, recording per
 *     broken reference whether it was repointed plus an edits summary. It
 *     keys each entry on the broken `target` string, NOT a finding `id`
 *     (Issues carry no stable identity).
 *
 * Built-ins bundle into `src/plugins/built-ins.ts` with no source directory
 * at runtime, so the built-ins codegen (`scripts/generate-built-ins.js`)
 * inlines both siblings onto the emitted manifest as `promptTemplate` +
 * `reportSchema`.
 *
 * Ships `stability: 'stable'`: ENABLED by default; the operator can disable
 * it (`sm plugins disable core/ai-reference-action`) to drop it as a submit
 * target.
 */

import type { IAction, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiReferenceAction: IBuiltInManifest<IAction> = {
  id: 'ai-reference-action',
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Fixes broken links a scan flagged: finds where each missing target actually lives in the project and repoints the link to it.',
  // Stable: enabled by default (the operator can disable it).
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL); a
  // single-node reference repair is a light pass on a mid-tier model.
  probExpectedDurationSeconds: 120,
  // Modelo B (deterministic side): this fixer resolves the Issues
  // core/reference-broken emits. A non-empty `analyzerIds` is ALSO the fixer
  // signal the submit path gates on; because the referenced analyzer is
  // deterministic, the kernel injects its `scan_issues` rows (not findings)
  // into the `## Issues to resolve` section.
  precondition: { analyzerIds: ['core/reference-broken'] },
  // No `invoke`: probabilistic Actions run OUTSIDE the process (claim +
  // record handover). No `project`: the fix is a queued job, not a
  // scan-time button.
};
