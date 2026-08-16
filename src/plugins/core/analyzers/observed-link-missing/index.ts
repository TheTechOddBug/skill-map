/**
 * `observed-link-missing` analyzer, the first design-vs-reality artifact
 * of the live arc (`spec/provider-activity.md` §Session journal ·
 * Consumption): the session journal RECORDS what actually executed; this
 * analyzer compares those observed relations against the AUTHORED link
 * graph and flags every pair reality exercised that the design never
 * declares. An emergent-use detector, not a defect finder, hence
 * severity `info` on every emission: the operator either promotes the
 * observation into the design (declares the link, which makes the issue
 * disappear on the next scan) or dismisses it durably via the standard
 * issue suppression (the emission carries `data.target`, so the generic
 * (analyzer, value) sidecar affordance applies unchanged).
 *
 * Match rule (normative in spec §Session journal): a declared link
 * COVERS an observed pair when
 *
 *   - `link.source === observed.source`, and
 *   - `(link.resolvedTarget ?? link.target) === observed.target`, and
 *   - `link.kind` is `invokes` OR `references`.
 *
 * Matching on the RESOLVED target first is critical: trigger-style links
 * keep the authored trigger (`@foo`) in `link.target`, so raw-target
 * matching would call every trigger-declared relation "missing".
 * `mentions` / `points` deliberately do NOT count: naming something is
 * not declaring that you execute it.
 *
 * Both endpoints must exist in the scanned node set: the journal can
 * outlive a deleted file or record an `mcp://` server no config or
 * frontmatter materialises, and an issue anchored on (or pointing at) a
 * phantom node would not be actionable. Dead-design detection (declared
 * but never observed) is deliberately NOT here: it needs a volume gate
 * (only meaningful once the source executed enough) and is deferred.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { IObservedRelation } from '../../../../kernel/session-journal/index.js';
import type { Issue, Link } from '../../../../kernel/types.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { tx } from '../../../../kernel/util/tx.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';
import { OBSERVED_LINK_MISSING_TEXTS as TEXTS } from './observed-link-missing.texts.js';

const ID = 'observed-link-missing';

/** Link kinds that count as a DECLARATION of execution (see module doc). */
const DECLARING_KINDS: ReadonlySet<string> = new Set(['invokes', 'references']);

export const observedLinkMissingAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags nodes observed invoking or spawning a target in recorded sessions that none of their declared links cover.',
  mode: 'deterministic',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const observed = ctx.observedRelations;
    if (observed === undefined || observed.size === 0) return [];

    const nodePaths = new Set(ctx.nodes.map((n) => n.path));
    const declared = collectDeclaredCoverage(ctx.links);
    const issues: Issue[] = [];
    // Sorted for deterministic emission order regardless of journal file
    // layout (same graph + same journal content -> same issue list).
    const entries = [...observed.values()].sort((a, b) =>
      `${a.source}\x00${a.target}`.localeCompare(`${b.source}\x00${b.target}`),
    );
    for (const entry of entries) {
      if (!nodePaths.has(entry.source) || !nodePaths.has(entry.target)) continue;
      if (declared.has(`${entry.source}\x00${entry.target}`)) continue;
      issues.push(buildIssue(entry));
    }
    return issues;
  },
};

/**
 * Declared coverage set, one pass over the links: `source\x00target` for
 * every execution-declaring edge, resolved target first (the fold keys
 * observed pairs by real node paths, so the two sides meet in the same
 * key space).
 */
function collectDeclaredCoverage(links: readonly Link[]): ReadonlySet<string> {
  const declared = new Set<string>();
  for (const link of links) {
    if (!DECLARING_KINDS.has(link.kind)) continue;
    declared.add(`${link.source}\x00${link.resolvedTarget ?? link.target}`);
  }
  return declared;
}

function buildIssue(entry: IObservedRelation): Issue {
  const noun =
    entry.relation === 'invokes'
      ? entry.count === 1
        ? TEXTS.invokesSingular
        : TEXTS.invokesPlural
      : entry.count === 1
        ? TEXTS.spawnsSingular
        : TEXTS.spawnsPlural;
  return {
    analyzerId: ID,
    severity: 'info',
    nodeIds: [entry.source],
    message: formatFinding({
      subject: entry.target,
      body: tx(TEXTS.message, {
        count: entry.count,
        noun,
        sessions: entry.sessions,
        sessionsPlural: entry.sessions === 1 ? '' : 's',
      }),
    }),
    fix: { summary: tx(TEXTS.fixSummary) },
    data: {
      // `target` is the dismiss key the generic (analyzer, value)
      // suppression gate and UI affordance read; `observedTarget` keeps
      // the semantic name alongside the evidence fields.
      target: entry.target,
      observedTarget: entry.target,
      relation: entry.relation,
      count: entry.count,
      sessions: entry.sessions,
      lastSeenAt: entry.lastSeenAt,
    },
  };
}
