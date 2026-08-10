/**
 * `GET /api/activity/probe?nonce=<nonce>`, the readback half of the
 * wiring self-test (see `spec/provider-activity.md` §Wiring self-test).
 *
 * `sm activity status --verify` spawns the installed bridge with a
 * synthetic probe event and then polls this route: `seen: true` proves
 * the whole downstream chain (bridge executes, resolves its scope root,
 * finds serve.json, passes its scope / loopback / port gates,
 * authenticates with the session token, reaches this server).
 *
 * Loopback-gated like every `/api/*` route; no serve.json token
 * (operator surface, same posture as the install probe). The probe's
 * INGEST leg is the token-gated `POST /api/activity`, so the self-test
 * still covers the token path end to end.
 */

import type { Hono } from 'hono';

import type { ActivityProbeStore } from '../activity-probe.js';
import { parseRequiredString } from '../util/parse-query.js';

export interface IActivityProbeRouteDeps {
  /** Boot-scoped nonce ring (composition-root owned). */
  probes: ActivityProbeStore;
}

export function registerActivityProbeRoute(app: Hono, deps: IActivityProbeRouteDeps): void {
  app.get('/api/activity/probe', (c) => {
    const nonce = parseRequiredString(c.req.query('nonce'), 'nonce');
    const at = deps.probes.arrivalOf(nonce);
    return c.json({ nonce, seen: at !== null, at });
  });
}
