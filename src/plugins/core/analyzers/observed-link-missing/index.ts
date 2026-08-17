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
 * phantom node would not be actionable. READ pairs (2026-08-17, the
 * reads class) are held to a stricter standard on both sides: they only
 * flag past `MIN_READ_OBSERVATIONS`, and a `points` link also covers
 * them (a backtick path naming the file declares that it matters here).
 * Dead-design detection lives in the sibling
 * `core/observed-link-dead`.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { IObservedRelation } from '../../../../kernel/session-journal/index.js';
import type { Issue, Link } from '../../../../kernel/types.js';
import type { TSettingDeclaration } from '../../../../kernel/types/view-catalog.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { tx } from '../../../../kernel/util/tx.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';
import { OBSERVED_LINK_MISSING_TEXTS as TEXTS } from './observed-link-missing.texts.js';

const ID = 'observed-link-missing';

/** Link kinds that count as a DECLARATION of execution (see module doc). */
const DECLARING_KINDS: ReadonlySet<string> = new Set(['invokes', 'references']);

/**
 * For READ pairs only, `points` also covers (spec §Consumption): a
 * backtick path naming the file already declares that the file matters
 * here. `mentions` (name-only) never covers anything.
 */
const READ_DECLARING_KINDS: ReadonlySet<string> = new Set(['invokes', 'references', 'points']);

/**
 * Repetition gate DEFAULT for READ pairs (spec §Consumption): reading
 * is routine where executing is deliberate, so a one-off read is not an
 * emergent-use signal (configurable per-extension since 2026-08-17).
 */
export const MIN_READ_OBSERVATIONS = 3;

const SETTING_MIN_READ_OBSERVATIONS = 'min-read-observations';

const settings = {
  [SETTING_MIN_READ_OBSERVATIONS]: {
    type: 'integer',
    label: 'Minimum read observations',
    description:
      'Observed reads of the same pair required before an undeclared read relation is flagged. Higher = fewer, stronger emergent-read findings.',
    default: MIN_READ_OBSERVATIONS,
    min: 1,
  },
} satisfies Record<string, TSettingDeclaration>;

export const observedLinkMissingAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags nodes observed invoking or spawning a target in recorded sessions that none of their declared links cover.',
  // Experimental (user decision 2026-08-17): the design-vs-reality trio
  // ships disabled until the evidence gates prove themselves in real
  // projects; the Settings toggle / `sm plugins enable` opts in.
  stability: 'experimental',
  mode: 'deterministic',
  settings,

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
    const minReads = minReadObservations(ctx);
    for (const entry of entries) {
      if (shouldFlag(entry, nodePaths, declared, minReads)) issues.push(buildIssue(entry));
    }
    return issues;
  },
};

/** Coverage sets by pair grain (see `collectDeclaredCoverage`). */
interface IDeclaredCoverage {
  forExecution: ReadonlySet<string>;
  forReads: ReadonlySet<string>;
}

/**
 * The per-pair gates: both endpoints scanned, the reads repetition
 * gate, then the grain-matched declared coverage.
 */
function shouldFlag(
  entry: IObservedRelation,
  nodePaths: ReadonlySet<string>,
  declared: IDeclaredCoverage,
  minReads: number,
): boolean {
  if (!nodePaths.has(entry.source) || !nodePaths.has(entry.target)) return false;
  if (entry.relation === 'reads' && entry.count < minReads) return false;
  const key = `${entry.source}\x00${entry.target}`;
  const covered =
    entry.relation === 'reads' ? declared.forReads.has(key) : declared.forExecution.has(key);
  return !covered;
}

/**
 * Declared coverage sets, one pass over the links: `source\x00target`
 * for every declaring edge, resolved target first (the fold keys
 * observed pairs by real node paths, so the two sides meet in the same
 * key space). Two grains: execution pairs (invokes / spawns) accept the
 * execution-declaring kinds only; read pairs also accept `points`.
 */
function collectDeclaredCoverage(links: readonly Link[]): IDeclaredCoverage {
  const forExecution = new Set<string>();
  const forReads = new Set<string>();
  for (const link of links) {
    if (!READ_DECLARING_KINDS.has(link.kind)) continue;
    const key = `${link.source}\x00${link.resolvedTarget ?? link.target}`;
    forReads.add(key);
    if (DECLARING_KINDS.has(link.kind)) forExecution.add(key);
  }
  return { forExecution, forReads };
}

function buildIssue(entry: IObservedRelation): Issue {
  const noun = relationNoun(entry);
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

/** Relation noun for the message (each relation pluralises its own way). */
function relationNoun(entry: IObservedRelation): string {
  if (entry.relation === 'invokes') {
    return entry.count === 1 ? TEXTS.invokesSingular : TEXTS.invokesPlural;
  }
  if (entry.relation === 'reads') {
    return entry.count === 1 ? TEXTS.readsSingular : TEXTS.readsPlural;
  }
  return entry.count === 1 ? TEXTS.spawnsSingular : TEXTS.spawnsPlural;
}

/** The read repetition gate, operator-tunable (integer setting, default 3). */
function minReadObservations(ctx: IAnalyzerContext): number {
  const raw = ctx.settings[SETTING_MIN_READ_OBSERVATIONS];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1
    ? raw
    : MIN_READ_OBSERVATIONS;
}
