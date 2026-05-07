/**
 * Playwright globalTeardown for the `live-bff` project (R10 closure).
 *
 * Tears down the server spawned by `global-setup.ts` and removes the
 * fixture tempdir. Idempotent — a second call (e.g. user-cancelled
 * run + retry) resolves without throwing.
 */

import { disposeLiveBffFixture } from './fixture.js';
import type { ILiveBffServer } from './server.js';

export default async function globalTeardown(): Promise<void> {
  const slot = (globalThis as Record<string, unknown>)['__SKILL_MAP_LIVE_BFF__'];
  if (slot && typeof slot === 'object' && 'shutdown' in slot) {
    try {
      await (slot as ILiveBffServer).shutdown();
    } catch {
      // Best-effort — globalTeardown must not throw or it leaves the
      // tempdir behind on every CI run.
    }
  }
  const cwd = process.env['LIVE_BFF_FIXTURE_CWD'];
  if (cwd) disposeLiveBffFixture(cwd);
}
