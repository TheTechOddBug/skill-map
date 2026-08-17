/**
 * `observed-link-dead` analyzer, the DEAD-DESIGN detector: the
 * second direction of the design-vs-reality diff
 * (`spec/provider-activity.md` §Session journal · Consumption). Where
 * `core/observed-link-missing` flags reality the design lacks, this one
 * flags design reality never confirms: a declared `invokes` /
 * `references` link that recorded sessions could have observed firing
 * and never did. Severity `info` on every emission: reality QUESTIONING
 * the authored design, never a defect; the operator removes or reworks
 * the stale declaration, or dismisses durably via the standard issue
 * suppression (`data.target` carries the resolved target, so the
 * generic (analyzer, value) sidecar affordance applies unchanged).
 *
 * Three gates keep the claim honest (normative in spec §Consumption):
 *
 *   - OBSERVABILITY: reality must have had an evidence class that could
 *     confirm the link. An `invokes` link needs a resolved target that
 *     is an `mcp://` node or an `agent`-kind node (the invokes / spawns
 *     classes); a `references` link is observable toward ANY scanned
 *     target since the reads class joined (2026-08-17): every scanned
 *     node can be read. An `invokes` link to a skill or command stays
 *     unjudged, unit-to-unit execution pairs are not folded.
 *   - VOLUME: the source must have executed at least
 *     `MIN_SOURCE_RUNS` times across recorded sessions
 *     (`ctx.observedExecutions`). Absence of evidence means nothing
 *     until the source demonstrably ran.
 *   - ABSENCE: the (source, resolved target) pair appears in no
 *     recorded session (`ctx.observedRelations`).
 *
 * Both endpoints must exist in the scanned set, self-links are skipped,
 * and the ABSENCE check spans every relation class (a pair observed as
 * a read confirms a `references` link). Matching on the RESOLVED target
 * first mirrors the sibling analyzer: trigger-style links keep the
 * authored trigger in `link.target`, so raw-target matching would
 * misjudge them.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { IObservedExecution } from '../../../../kernel/session-journal/index.js';
import type { Issue, Link, Node } from '../../../../kernel/types.js';
import type { TSettingDeclaration } from '../../../../kernel/types/view-catalog.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { MCP_NODE_PREFIX } from '../../../../kernel/util/mcp.js';
import { tx } from '../../../../kernel/util/tx.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';
import { OBSERVED_LINK_DEAD_TEXTS as TEXTS } from './observed-link-dead.texts.js';

const ID = 'observed-link-dead';

/** Link kinds that count as a DECLARATION of execution (sibling's rule). */
const DECLARING_KINDS: ReadonlySet<string> = new Set(['invokes', 'references']);

/**
 * The volume gate's DEFAULT: minimum observed unit runs of the SOURCE
 * before its silence about a declared link is worth an issue
 * (configurable per-extension since 2026-08-17).
 */
export const MIN_SOURCE_RUNS = 3;

const SETTING_MIN_SOURCE_RUNS = 'min-source-runs';

const settings = {
  [SETTING_MIN_SOURCE_RUNS]: {
    type: 'integer',
    label: 'Minimum source runs',
    description:
      'Observed unit runs of the link source required before a never-confirmed declared link is flagged. Higher = more evidence before the claim.',
    default: MIN_SOURCE_RUNS,
    min: 1,
  },
} satisfies Record<string, TSettingDeclaration>;

/** Node kind observable through the fold's `spawns` evidence class. */
const SPAWNABLE_KIND = 'agent';

export const observedLinkDeadAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags declared invokes/references links that recorded sessions could have observed firing but never did, once the source executed enough.',
  // Experimental (user decision 2026-08-17): see observed-link-missing.
  stability: 'experimental',
  mode: 'deterministic',
  settings,

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const executions = ctx.observedExecutions;
    if (executions === undefined || executions.byPath.size === 0) return [];

    const nodesByPath = new Map(ctx.nodes.map((n) => [n.path, n]));
    const observedPairs = new Set(ctx.observedRelations?.keys() ?? []);
    const candidates = collectCandidates(
      ctx.links,
      nodesByPath,
      executions.byPath,
      observedPairs,
      minSourceRuns(ctx),
    );
    // Sorted for deterministic emission order regardless of link
    // extraction order (same graph + same journal -> same issue list).
    return [...candidates.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, candidate]) => buildIssue(candidate));
  },
};

interface ICandidate {
  source: string;
  target: string;
  runs: IObservedExecution;
}

/**
 * One pass over the links: dedupe by (source, resolved target) pair and
 * keep only the pairs that clear all three gates (see module doc).
 */
function collectCandidates(
  links: readonly Link[],
  nodesByPath: ReadonlyMap<string, Node>,
  executions: ReadonlyMap<string, IObservedExecution>,
  observedPairs: ReadonlySet<string>,
  minRuns: number,
): Map<string, ICandidate> {
  const candidates = new Map<string, ICandidate>();
  for (const link of links) {
    const candidate = candidateFor(link, nodesByPath, executions, minRuns);
    if (candidate === null) continue;
    const key = `${candidate.source}\x00${candidate.target}`;
    if (candidates.has(key) || observedPairs.has(key)) continue;
    candidates.set(key, candidate);
  }
  return candidates;
}

/** The per-link gates (observability + volume); `null` = not a candidate. */
function candidateFor(
  link: Link,
  nodesByPath: ReadonlyMap<string, Node>,
  executions: ReadonlyMap<string, IObservedExecution>,
  minRuns: number,
): ICandidate | null {
  if (!DECLARING_KINDS.has(link.kind)) return null;
  const target = link.resolvedTarget ?? link.target;
  if (link.source === target || !nodesByPath.has(link.source)) return null;
  if (!observableTargetExists(nodesByPath, link.kind, target)) return null;
  const runs = executions.get(link.source);
  if (runs === undefined || runs.count < minRuns) return null;
  return { source: link.source, target, runs };
}

/** Both endpoint gates on the target side: scanned AND observable. */
function observableTargetExists(
  nodesByPath: ReadonlyMap<string, Node>,
  linkKind: string,
  target: string,
): boolean {
  const node = nodesByPath.get(target);
  if (node === undefined) return false;
  // `references`: any scanned target is confirmable via the reads class.
  if (linkKind === 'references') return true;
  // `invokes`: only the invokes / spawns evidence classes apply.
  return node.path.startsWith(MCP_NODE_PREFIX) || node.kind === SPAWNABLE_KIND;
}

function buildIssue(candidate: ICandidate): Issue {
  const { runs } = candidate;
  return {
    analyzerId: ID,
    severity: 'info',
    nodeIds: [candidate.source],
    message: formatFinding({
      subject: candidate.target,
      body: tx(TEXTS.message, {
        runs: runs.count,
        runsPlural: runs.count === 1 ? '' : 's',
        sessions: runs.sessions,
        sessionsPlural: runs.sessions === 1 ? '' : 's',
      }),
    }),
    fix: { summary: tx(TEXTS.fixSummary) },
    data: {
      // `target` is the dismiss key the generic (analyzer, value)
      // suppression gate and UI affordance read; `declaredTarget` keeps
      // the semantic name alongside the evidence fields.
      target: candidate.target,
      declaredTarget: candidate.target,
      runs: runs.count,
      sessions: runs.sessions,
      lastRunAt: runs.lastSeenAt,
    },
  };
}

/** The volume gate, operator-tunable (integer setting, default 3). */
function minSourceRuns(ctx: IAnalyzerContext): number {
  const raw = ctx.settings[SETTING_MIN_SOURCE_RUNS];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : MIN_SOURCE_RUNS;
}
