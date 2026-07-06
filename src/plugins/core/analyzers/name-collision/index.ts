/**
 * `name-collision` rule. Flags ambiguous name OWNERSHIP: two or more
 * nodes whose kind declares `frontmatter.name` as a resolution identifier
 * claim the same normalised name. The resolver keys on that identifier,
 * so a reference to the name resolves to one node and shadows the others,
 * a real ambiguity the user resolves by renaming one.
 *
 * Pure projector of the orchestrator's `ctx.nameCollisions` verdict,
 * computed once from the kind registry (the same precompute-and-project
 * pattern as `core/reference-broken` reading `ctx.brokenLinks`). The rule
 * does not re-derive identifiers: the kernel owns "which kinds resolve by
 * name" (plain `core/markdown`, addressed by path, never collides) and
 * "which names normalise together" (`Deploy` / `deploy`).
 *
 * Was `trigger-collision`, which keyed on the slashed trigger
 * (`'/' + name`) and also flagged case / separator variants of one
 * INVOCATION (`/Deploy` vs `/deploy`). Those resolve to the same node
 * (the normalizer is case-insensitive), so the old `error` was a false
 * positive; and the slash subject was wrong for agents (invoked with
 * `@`). Keying on the bare resolved name drops the sigil and the false
 * positives, and covers every name-resolvable kind (agent, command,
 * skill, mcp-tool) instead of a hardcoded `{command, skill, agent}` set.
 *
 * Two severity tiers (spec §Provider · kind identifiers · Name
 * collisions): `error` when two or more distinct nodes DECLARE the same
 * name via `frontmatter.name` (the rule can't pick which claimant is
 * "right"; the user has to rename one), `warn` when a declared name
 * collides with another node's path-derived handle (filename stem /
 * dirname), authored shadowing that resolution disambiguates
 * deterministically but the author almost never intended.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { NAME_COLLISION_TEXTS } from './name-collision.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'name-collision';

export const nameCollisionAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  mode: 'deterministic',
  description: 'Flags two or more nodes that declare the same resolvable `name`.',

  // Pure projector of `ctx.nameCollisions` (computed once by the
  // orchestrator from the kind registry). Two tiers per colliding name
  // (spec §Provider · kind identifiers · Name collisions): `error` when
  // two or more distinct nodes DECLARE the name via `frontmatter.name`
  // (the historic verdict, the user must rename one), `warn` for a mixed
  // bucket where a declared name collides with another node's filename /
  // dirname handle (resolution still picks a deterministic winner, but
  // the shadowing is authored and usually unintentional).
  evaluate(ctx: IAnalyzerContext): Issue[] {
    const collisions = ctx.nameCollisions;
    if (!collisions || collisions.size === 0) return [];
    const issues: Issue[] = [];
    for (const [name, claims] of collisions) {
      const paths = claims.map((c) => c.path);
      const declaredCount = claims.filter((c) => c.source === 'frontmatter.name').length;
      const isError = declaredCount >= 2;
      issues.push({
        analyzerId: ID,
        severity: isError ? 'error' : 'warn',
        nodeIds: paths,
        message: formatFinding({
          subject: name,
          body: tx(isError ? NAME_COLLISION_TEXTS.message : NAME_COLLISION_TEXTS.messageShadow, {
            count: paths.length,
            paths: paths.join(', '),
          }),
        }),
        data: {
          name,
          claims: claims.map((c) => ({ path: c.path, kind: c.kind, source: c.source })),
        },
      });
    }
    return issues;
  },
};
