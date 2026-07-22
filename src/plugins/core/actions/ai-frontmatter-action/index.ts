/**
 * Built-in probabilistic `ai-frontmatter-action` Action (user request
 * 2026-07-22): generates or completes a node's YAML frontmatter
 * automatically. A STANDALONE action (no `precondition.analyzerIds`),
 * so it rides the standalone launcher row with the sparkles icon and
 * the ALL-standalone button, and doubles as the test bench for that
 * mechanism.
 *
 * Scope boundary with its siblings: this action only FILLS GAPS, a
 * missing frontmatter block, a missing `name`, a missing `description`.
 * It never rewrites an existing value: auditing / improving an EXISTING
 * description is `core/ai-trigger-analyzer`'s job, and a declared name
 * diverging from the file handle is `core/name-mismatch`'s. The prompt
 * aligns with both: the generated `name` matches the file-derived
 * handle (so it never births a name-mismatch), and the generated
 * `description` says what the body does plus WHEN to invoke it (the
 * trigger pair's standard).
 *
 * As a probabilistic Action it carries NO in-process `invoke` and NO
 * scan-time `project`: the kernel renders `prompt.md` + the canonical
 * preamble + the report contract into a queued job, an external agent
 * processes it (`sm jobs claim`), performs the frontmatter edit with
 * its own tools (the job snapshot is BODY-ONLY, so the prompt instructs
 * reading the live file first, same as the trigger / scope finders),
 * and `sm record` validates the JSON report against
 * `report.schema.json`. skill-map NEVER writes the file; the next scan
 * re-derives the frontmatter.
 *
 * Structure-as-truth siblings (`prompt.md` + `report.schema.json`) are
 * inlined onto the emitted manifest by the built-ins codegen.
 *
 * Ships `stability: 'experimental'`: DISABLED by default (the birth
 * convention; graduates once the prompt proves itself in the live
 * playground like the five optimization pairs did). Enable with
 * `sm plugins enable core/ai-frontmatter-action`.
 */

import type { IAction, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiFrontmatterAction: IBuiltInManifest<IAction> = {
  id: 'ai-frontmatter-action',
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Writes the frontmatter a file is missing: a name matching the filename and a description saying what the file does and when to use it. Never touches fields you already wrote.',
  // Experimental: ships disabled until the prompt proves itself.
  stability: 'experimental',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL); a
  // single-node frontmatter fill is a light pass on a mid-tier model.
  probExpectedDurationSeconds: 60,
  // The `frontmatterMissing` gap gate (user call 2026-07-22): the
  // launcher button and the `--all` fan-out apply only while the node
  // is actually missing `name` or `description`; a file already
  // carrying both never lists the action (nothing to fill). The prompt
  // still returns a clean `kept` report if a race lands a complete
  // file on the processing agent.
  precondition: { frontmatterMissing: ['name', 'description'] },
  // No `invoke`: probabilistic Actions run OUTSIDE the process (claim +
  // record handover). No `project`: the fill is a queued job, not a
  // scan-time button.
};
