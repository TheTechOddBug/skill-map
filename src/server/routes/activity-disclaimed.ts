/**
 * `GET /api/activity/disclaimed`, the mapper-digest readback (see
 * `spec/provider-activity.md` §Mapper digest).
 *
 * The complement of the probe readback next door: that route proves the
 * transport reached this server, this one reports what the Provider's
 * `mapEvent` did with the payloads the RUNTIME actually sent. A
 * Provider reporting `received > 0` with `resolved: 0` has a live
 * runtime and a broken mapper, and the reported key names are the
 * vocabulary its adapter was handed.
 *
 * Loopback-gated like every `/api/*` route; no `serve.json` token
 * (operator surface, same posture as the probe readback). Read-only:
 * reporting never clears the digest.
 */

import type { Hono } from 'hono';

import type { ActivityDisclaimedStore } from '../activity-disclaimed.js';

export interface IActivityDisclaimedRouteDeps {
  /** Boot-scoped disclaimed-shape digest (composition-root owned). */
  disclaimed: ActivityDisclaimedStore;
}

export function registerActivityDisclaimedRoute(
  app: Hono,
  deps: IActivityDisclaimedRouteDeps,
): void {
  app.get('/api/activity/disclaimed', (c) => {
    // An unknown / never-seen id reports zeroed counters rather than
    // erroring: "this provider has received nothing" IS the answer.
    const provider = c.req.query('provider');
    const providers = deps.disclaimed.report(
      provider !== undefined && provider.length > 0 ? provider : undefined,
    );
    return c.json({ providers });
  });
}
