/**
 * Built-in probabilistic `ai-name-action` Action, a fixer for the
 * DETERMINISTIC `core/name-mismatch` analyzer (user request 2026-07-22,
 * "like the reference-broken case"; `spec/architecture.md` §Analyzer ↔
 * Action relationship (Modelo B) covers both analyzer modes: for a
 * deterministic analyzer the trigger is its `Issue` rows). It resolves
 * `name-mismatch` Issues by settling the node's dual identity: align the
 * declared `frontmatter.name` with the file-derived handle, or (only by
 * the author's explicit choice) rename the file / folder to match the
 * declared name.
 *
 * Deterministic-analyzer fixer, so like `ai-reference-action` it is
 * UNLIKE the finder-paired fixers in two ways:
 *   - the submit path injects the node's `core/name-mismatch` ISSUES
 *     (from `scan_issues`, via `selectFixerIssues` / `buildIssuesSection`)
 *     into a `## Issues to resolve` section, not `state_findings`; and
 *   - it is exempt from the `ai-<subject>-analyzer` / `ai-<subject>-action`
 *     pairing convention (it consumes a deterministic Rule and is named
 *     after what it fixes, the node's name, not after its analyzer).
 *
 * As a probabilistic Action it carries NO in-process `invoke` and NO
 * scan-time `project`: the kernel renders `prompt.md` + the canonical
 * preamble + the injected Issues + the report contract into a queued job,
 * an external agent processes it (`sm jobs claim`), performs the edit
 * with its own tools, and `sm record` validates the JSON report against
 * `report.schema.json`. skill-map NEVER writes the node body; the next
 * scan re-derives the identifiers and the settled name clears its
 * `name-mismatch` Issue via the body-hash rule. There is no finding to
 * stamp: an Issue has no stable id, the fix's evidence IS the next scan.
 *
 * **Rename caution.** Renaming the file / folder (instead of editing
 * `frontmatter.name`) changes the node's path identity and can break
 * inbound references, so the prompt reserves it for an explicit
 * interactive choice by the author; the autonomous fix is always the
 * frontmatter edit. For dirname-mandated kinds (the open-standard
 * `SKILL.md`, whose standard requires name == parent dirname) aligning
 * the declared name to the dirname is the only spec-conforming edit.
 *
 * Structure-as-truth siblings (`prompt.md` + `report.schema.json`) are
 * inlined onto the emitted manifest by the built-ins codegen.
 *
 * Ships `stability: 'stable'`: ENABLED by default, mirror of
 * `ai-reference-action`; the operator can disable it to drop it as a
 * submit target.
 */

import type { IAction, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiNameAction: IBuiltInManifest<IAction> = {
  id: 'ai-name-action',
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    "Fixes name mismatches a scan flagged: aligns the declared `name` with the file-derived handle so the node answers to one name (renaming the file instead is offered only as the author's choice).",
  // Stable: enabled by default (the operator can disable it).
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL); a
  // single-field alignment is lighter than a reference repair.
  probExpectedDurationSeconds: 60,
  // Modelo B (deterministic side): this fixer resolves the Issues
  // core/name-mismatch emits. A non-empty `analyzerIds` is ALSO the fixer
  // signal the submit path gates on; because the referenced analyzer is
  // deterministic, the kernel injects its `scan_issues` rows (not
  // findings) into the `## Issues to resolve` section.
  precondition: { analyzerIds: ['core/name-mismatch'] },
  // No `invoke`: probabilistic Actions run OUTSIDE the process (claim +
  // record handover). No `project`: the fix is a queued job, not a
  // scan-time button.
};
