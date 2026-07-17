/**
 * `core/auto-fix` hook (Decision #144). The opt-in half of the
 * finder -> fixer chain (`spec/architecture.md` §Analyzer ↔ Action
 * relationship (Modelo B), "Auto-fix (opt-in)").
 *
 * Ships DISABLED (`stability: 'experimental'`): enabling it means "edit my
 * files before I read the findings", so it is opt-in via
 * `sm plugins enable core/auto-fix` (or the Settings toggle), never a
 * silent default.
 *
 * Subscribes to `job.completed`, filtered to `extensionKind: 'analyzer'`
 * (a finder just closed). On dispatch it resolves the INVERSE of Modelo B,
 * every loaded Action whose `precondition.analyzerIds` includes the
 * just-run finder (the same join the inspector's "Recommended for issues"
 * uses), and `ctx.queue`s each matching fixer for the node. It composes
 * with pull-only: the hook fires inside `sm record`, so the processing
 * agent's own loop continues into the fix in one session.
 *
 * Cleanly degenerate:
 *   - No `ctx.queue` (the driver did not wire queueing) or no finder /
 *     node id on the event -> nothing to do.
 *   - No matching fixer -> nothing queued.
 *   - Several matching fixers -> all queued.
 *   - A fixer over a node with NO matching findings refuses at submit;
 *     that refusal is SWALLOWED here so a "no findings" case never throws
 *     out of the hook (the dispatcher would catch it anyway, but swallowing
 *     is the correct response: "nothing to fix" is not an error).
 *
 * Deterministic-only, like every hook since the structure-as-truth
 * refactor: the LLM work is the queued fixer job, not this hook.
 */

import type { IBuiltInManifest, IHook, IHookContext } from '../../../../kernel/extensions/index.js';
import { resolveMatchingFixerIds } from '../../../../core/jobs/auto-fix-chain.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

/** Payload fields the hook reads off a `job.completed` event (`spec/job-events.md`). */
interface IJobCompletedData {
  /** The finished job's frozen extension id (the finder, qualified). */
  extensionId?: unknown;
  /** The frozen extension kind; the declarative filter already pins `analyzer`. */
  extensionKind?: unknown;
}

export const autoFixHook: IBuiltInManifest<IHook> = {
  id: 'auto-fix',
  pluginId: CORE_PLUGIN_ID,
  kind: 'hook',
  description:
    'Runs matching fixers automatically after a finder completes. Ships disabled; enable to have fixers edit your files before you read the findings.',
  // Ships experimental (disabled by default): auto-editing files is a loud,
  // deliberate opt-in (`sm plugins enable core/auto-fix`).
  stability: 'experimental',
  triggers: ['job.completed'],
  // Only a finder's completion chains to a fixer; the declarative filter
  // short-circuits every other completed job before `on()` runs.
  filter: { extensionKind: 'analyzer' },

  on(ctx: IHookContext): void {
    queueMatchingFixers(ctx);
  },
};

/**
 * Resolve the inverse Modelo B lookup and queue every matching fixer for
 * the finder's node. A no-op when the driver did not wire `ctx.queue`, or
 * the event carries no finder / node id.
 */
function queueMatchingFixers(ctx: IHookContext): void {
  const queue = ctx.queue;
  if (typeof queue !== 'function') return;
  const target = readTarget(ctx);
  if (target === null) return;

  for (const fixerId of resolveMatchingFixerIds(target.finderId, ctx.actions ?? [])) {
    try {
      queue(fixerId, { nodeId: target.nodeId });
    } catch {
      // A fixer submitted over a node with no matching findings refuses;
      // "nothing to fix" is not an error, so it must not escape the hook.
    }
  }
}

/**
 * Extract the finished finder's qualified id (from the event payload) + the
 * judged node (from `ctx.node`, populated by the driver from the completed
 * job's node), or `null` when either is missing (a driver that did not
 * supply the node, an off-shape event).
 */
function readTarget(ctx: IHookContext): { finderId: string; nodeId: string } | null {
  const data = (ctx.event.data ?? {}) as IJobCompletedData;
  const finderId = typeof data.extensionId === 'string' ? data.extensionId : undefined;
  const nodeId = ctx.node?.path;
  if (finderId === undefined || nodeId === undefined || nodeId.length === 0) return null;
  return { finderId, nodeId };
}
