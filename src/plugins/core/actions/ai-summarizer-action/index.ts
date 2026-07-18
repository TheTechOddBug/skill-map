/**
 * Built-in probabilistic `ai-summarizer-action` Action, the FIRST
 * probabilistic built-in Action and the UNIVERSAL node summarizer.
 *
 * Summarizes any node into a structured brief: `markdown` names the body
 * format it reads (every node body is markdown prose, including
 * frontmatter-field bodies like codex TOML `developer_instructions`), not
 * a node-kind gate. There is deliberately NO `precondition`, so a
 * `sm jobs submit ai-summarizer-action --all` fan-out reaches every
 * non-virtual node; per-kind summarizers were dropped by decision (see
 * `ROADMAP.md` §Summarizer pattern). Unlike
 * the deterministic built-in actions (`node-bump`, `node-set-stability`,
 * `node-set-tags`), this Action carries NO in-process `invoke` and NO
 * scan-time `project`: probabilistic actions run OUTSIDE the process, the
 * kernel renders `prompt.md` + the canonical preamble into a queued job
 * (`sm jobs submit`), an external agent processes it (`sm jobs claim`), and
 * `sm record` closes the job by validating the agent's JSON report
 * against `report.schema.json`.
 *
 * **Structure-as-truth siblings.** The Action ships two files next to this
 * manifest:
 *   - `prompt.md`, the prompt template (with the single `{{userContent}}`
 *     placeholder the render engine wraps in `<user-content>`).
 *   - `report.schema.json`, the JSON Schema for the report. It `$ref`s the
 *     canonical `summaries/markdown.schema.json`, and that reference is
 *     ALSO the summarizer signal: an Action whose report schema extends a
 *     `summaries/<kind>` schema gets the `state_summaries` write-through
 *     at record time (`spec/job-lifecycle.md` §Record). No manifest flag.
 *
 * Built-ins bundle into `src/plugins/built-ins.ts` as plain manifest objects
 * with no source directory at runtime, so the built-ins codegen
 * (`scripts/generate-built-ins.js`) reads those two sibling files at build
 * time and inlines them onto the emitted manifest as `promptTemplate` +
 * `reportSchema`. That is the built-in equivalent of the on-disk files a
 * user plugin resolves from its own directory. See `IAction` in
 * `kernel/extensions/action.ts`.
 */

import type { IAction, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiSummarizerAction: IBuiltInManifest<IAction> = {
  id: 'ai-summarizer-action',
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    "Summarizes a node's markdown content into a structured brief (probabilistic; an agent processes it via `sm jobs claim` + `sm record`).",
  mode: 'probabilistic',
  // Best-effort wall-clock estimate; drives the job TTL. Two minutes is a
  // safe upper bound for a single-file summary on a mid-tier model.
  probExpectedDurationSeconds: 120,
  // No precondition: the summarizer is universal, `--all` fans out to
  // every non-virtual node regardless of kind.
};
