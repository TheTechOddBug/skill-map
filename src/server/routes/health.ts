/**
 * `GET /api/health`, liveness + version probe used by the SPA bootstrap.
 *
 * Extracted from `app.ts` for symmetry with the other Step 14.2 routes.
 * The response shape and the underlying `buildHealth` helper still live
 * in `src/server/health.ts` (unchanged from 14.1).
 */

import type { Hono } from 'hono';

import type { IRuntimeContext } from '../../core/runtime/runtime-context.js';
import { buildHealth } from '../health.js';
import type { IServerOptions } from '../options.js';

export interface IHealthRouteDeps {
  options: IServerOptions;
  runtimeContext: IRuntimeContext;
  /** Pre-resolved spec version (sync at request time, boot-time async resolve). */
  specVersion: string;
}

export function registerHealthRoute(app: Hono, deps: IHealthRouteDeps): void {
  app.get('/api/health', (c) => {
    const payload = buildHealth({
      dbPath: deps.options.dbPath,
      cwd: deps.runtimeContext.cwd,
      specVersion: deps.specVersion,
      mcpServer: deps.options.mcpServer,
    });
    return c.json(payload);
  });
}
