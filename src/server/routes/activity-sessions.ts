/**
 * `DELETE /api/activity/sessions`, the session-journal wipe
 * (`spec/provider-activity.md` §Session journal · Deletion): empties
 * `.skill-map/sessions/` AND the serve process's open in-memory session
 * buffers in one gesture, so a pending debounce flush cannot resurrect
 * a wiped file. Always `204` (an absent directory included, the wipe is
 * idempotent); ONE `activity.sessions-clear` operations line with the
 * deleted count (`spec/cli-contract.md` §Operations log).
 *
 * Loopback-gated like every `/api/*` route, NO serve.json token: this
 * is an operator UI surface (the SPA's delete-recording affordances
 * call it together with clearing the client tape, behind a confirm
 * that names the analyzer-evidence cost), not the bridge's ingest path.
 */

import type { Hono } from 'hono';

import { appendOperation } from '../../core/operations-log.js';
import type { IRuntimeContext } from '../../core/runtime/runtime-context.js';
import type { ActivityJournalService } from '../activity-journal.js';

export interface IActivitySessionsRouteDeps {
  /**
   * Session journal (composition-root owned, explicit extra dep by the
   * activity custody contract, never on `IRouteDeps`).
   */
  journal: ActivityJournalService;
  /** Boot runtime context; `cwd` anchors the operations-log line. */
  runtimeContext: IRuntimeContext;
}

export function registerActivitySessionsRoute(
  app: Hono,
  deps: IActivitySessionsRouteDeps,
): void {
  app.delete('/api/activity/sessions', (c) => {
    const deleted = deps.journal.clearAll();
    appendOperation(deps.runtimeContext.cwd, {
      op: 'activity.sessions-clear',
      target: '*',
      channel: 'ui',
      outcome: 'ok',
      detail: `deleted=${deleted}`,
    });
    return c.body(null, 204);
  });
}
