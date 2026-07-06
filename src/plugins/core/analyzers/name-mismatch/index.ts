/**
 * `name-mismatch` rule. Flags a node whose declared `frontmatter.name`
 * diverges from a path-derived identifier its kind also resolves by
 * (filename stem for agents / commands, parent dirname for skills). The
 * resolver registers EVERY declared identifier, so such a node silently
 * answers to BOTH names; nothing else surfaces the dual identity.
 *
 * Pure projector of the orchestrator's `ctx.nameMismatches` verdict
 * (`collectNameMismatches`, computed once from the kind registry), the
 * same precompute-and-project pattern as `core/name-collision` reading
 * `ctx.nameCollisions`. Severity travels IN the verdict, resolved from
 * the per-kind `identifierMismatch` knob at precompute time: `warn`
 * where the kind's standard REQUIRES agreement (the open-standard skill
 * kind mandates name == parent dirname), `info` where the runtime
 * documents the override as legal (Anthropic skills / agents /
 * commands, OpenAI Codex agents) yet the dual identity is still worth
 * surfacing. Both sides compare NORMALISED, so case / separator
 * variants that collapse to one resolution entry never mismatch.
 * Normative contract: `spec/architecture.md` §Provider · kind
 * identifiers · Identifier agreement.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { NAME_MISMATCH_TEXTS } from './name-mismatch.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'name-mismatch';

export const nameMismatchAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  mode: 'deterministic',
  description: 'Flags a node whose declared `name` differs from its file-derived handle.',

  // Pure projector of `ctx.nameMismatches` (computed once by the
  // orchestrator from the per-kind `identifierMismatch` knob). One issue
  // per divergent (node, path source) pair, severity from the verdict.
  evaluate(ctx: IAnalyzerContext): Issue[] {
    const mismatches = ctx.nameMismatches;
    if (!mismatches || mismatches.length === 0) return [];
    return mismatches.map((m) => ({
      analyzerId: ID,
      severity: m.severity,
      nodeIds: [m.path],
      message: formatFinding({
        subject: m.declaredName,
        body: tx(NAME_MISMATCH_TEXTS.message, {
          sourceLabel: NAME_MISMATCH_TEXTS.sourceLabels[m.derivedSource],
          derivedName: m.derivedName,
        }),
      }),
      data: {
        declaredName: m.declaredName,
        derivedName: m.derivedName,
        derivedSource: m.derivedSource,
      },
    }));
  },
};
