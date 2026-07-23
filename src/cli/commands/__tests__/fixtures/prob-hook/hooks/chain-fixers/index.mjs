/**
 * Test-only `job.completed` hook: the drop-in equivalent of the removed
 * `core/auto-fix` built-in (2026-07-21). Subscribes to finder
 * completions and `ctx.queue`s every loaded Action whose
 * `precondition.analyzerIds` names the just-run finder, for the judged
 * node. Keeps the record-side hook dispatch + queue sink covered end to
 * end now that no built-in hook ships.
 */
export default {
  version: '1.0.0',
  description: 'Test-only hook chaining matching fixers after a finder completes.',
  triggers: ['job.completed'],
  filter: { extensionKind: 'analyzer' },

  on(ctx) {
    const queue = ctx.queue;
    if (typeof queue !== 'function') return;
    const data = ctx.event.data ?? {};
    const finderId = typeof data.extensionId === 'string' ? data.extensionId : undefined;
    const nodeId = ctx.node?.path;
    if (finderId === undefined || nodeId === undefined || nodeId.length === 0) return;
    for (const action of ctx.actions ?? []) {
      // `ctx.actions` entries are the dispatcher's narrow projection:
      // `{ id, analyzerIds }` (IHookActionInfo), not full IAction.
      if (!(action.analyzerIds ?? []).includes(finderId)) continue;
      try {
        queue(action.id, { nodeId });
      } catch {
        // "Nothing to fix" refusals must not escape the hook.
      }
    }
  },
};
