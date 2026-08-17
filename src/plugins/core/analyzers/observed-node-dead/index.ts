/**
 * `observed-node-dead` analyzer, the NODE-LEVEL dead-design detector
 * (`spec/provider-activity.md` §Session journal · Consumption): where
 * `core/observed-link-dead` questions a LINK reality never
 * confirms, this one questions the NODE itself: a runnable unit that
 * never executed in any recorded session, despite plenty of recorded
 * activity around it. Severity `info` on every emission: reality
 * questioning the authored design, never a defect; the operator reworks
 * or retires the unit, or dismisses durably via the standard issue
 * suppression (`data.target` carries the node's own path as the
 * (analyzer, value) suppression key).
 *
 * Two gates keep the claim honest (normative in spec §Consumption):
 *
 *   - RUNNABILITY: only unit kinds flag (`skill`, `agent`, `command`,
 *     the kinds the executions fold can observe running). Docs, notes
 *     and virtual nodes (`mcp://…`) do not execute, so their silence
 *     proves nothing; an external provider's own kinds stay unjudged
 *     (safe silence) until they earn an entry here.
 *   - VOLUME: at least `MIN_ACTIVE_SESSIONS` recorded sessions produced
 *     unit runs (`ctx.observedExecutions.activeSessions`, the honest
 *     denominator: a recording where nothing executed proves nothing,
 *     and two quiet recordings prove even less).
 *
 * The absence itself is simply "no entry in `byPath`": any observed run
 * of the node, in any recording, silences it.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Node } from '../../../../kernel/types.js';
import type { TSettingDeclaration } from '../../../../kernel/types/view-catalog.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { tx } from '../../../../kernel/util/tx.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';
import { OBSERVED_NODE_DEAD_TEXTS as TEXTS } from './observed-node-dead.texts.js';

const ID = 'observed-node-dead';

/** Kinds the executions fold can observe running (the runnable units). */
const RUNNABLE_KINDS: ReadonlySet<string> = new Set(['skill', 'agent', 'command']);

/**
 * The volume gate's DEFAULT: minimum ACTIVE recorded sessions (sessions
 * with at least one unit run) before a node's total silence is worth an
 * issue (user call 2026-08-17: "unas 20", configurable the same day).
 */
export const MIN_ACTIVE_SESSIONS = 20;

const SETTING_MIN_ACTIVE_SESSIONS = 'min-active-sessions';

const settings = {
  [SETTING_MIN_ACTIVE_SESSIONS]: {
    type: 'integer',
    label: 'Minimum active sessions',
    description:
      'Recorded sessions with at least one unit run required before a never-executed node is flagged. Higher = more evidence before the claim.',
    default: MIN_ACTIVE_SESSIONS,
    min: 1,
  },
} satisfies Record<string, TSettingDeclaration>;

export const observedNodeDeadAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags runnable nodes (skills, agents, commands) that never executed in any recorded session, once enough recorded activity accumulated.',
  // Experimental (user decision 2026-08-17): see observed-link-missing.
  stability: 'experimental',
  mode: 'deterministic',
  settings,

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const executions = ctx.observedExecutions;
    if (executions === undefined || executions.activeSessions < minActiveSessions(ctx)) return [];

    const issues: Issue[] = [];
    // ctx.nodes is scan-ordered and stable, so emission order is too.
    for (const node of ctx.nodes) {
      if (!RUNNABLE_KINDS.has(node.kind)) continue;
      if (node.virtual === true) continue;
      if (executions.byPath.has(node.path)) continue;
      issues.push(buildIssue(node, executions.activeSessions));
    }
    return issues;
  },
};

function buildIssue(node: Node, activeSessions: number): Issue {
  return {
    analyzerId: ID,
    severity: 'info',
    nodeIds: [node.path],
    message: formatFinding({
      subject: node.path,
      body: tx(TEXTS.message, { sessions: activeSessions }),
    }),
    fix: { summary: tx(TEXTS.fixSummary) },
    data: {
      // The node's own path as the dismiss key: the generic
      // (analyzer, value) suppression silences THIS node durably.
      target: node.path,
      activeSessions,
    },
  };
}

/** The volume gate, operator-tunable (integer setting, default 20). */
function minActiveSessions(ctx: IAnalyzerContext): number {
  const raw = ctx.settings[SETTING_MIN_ACTIVE_SESSIONS];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : MIN_ACTIVE_SESSIONS;
}
