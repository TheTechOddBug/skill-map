/**
 * Playwright globalSetup for the `live-bff` project (R10 closure).
 *
 * Materialises a fresh fixture under `<repoRoot>/.tmp/e2e-live-bff-<ts>/`,
 * spawns `sm serve` against it, waits for `/api/health` 200, and stashes
 * the base URL + cleanup metadata on env vars so:
 *
 *   1. Tests can read `process.env.LIVE_BFF_URL` from inside their fixtures
 *      (Playwright spawns workers as separate Node processes, so module-
 *      scoped state would NOT cross over).
 *   2. globalTeardown can find the spawned PID + tempdir to clean up.
 *
 * The whole harness is opt-in via `npx playwright test --project=live-bff`
 * (or by tagging via `--grep "live-BFF"`); CI does not require the live
 * infra by default — see `e2e/README.md` §Live-BFF mode.
 *
 * Skipped silently when invoked without the live-bff project — Playwright
 * still calls globalSetup once per `playwright test` invocation, but
 * adding cheap fast-paths here makes the static-only run almost free.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLiveBffFixture } from './fixture.js';
import { spawnLiveBff } from './server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(E2E_ROOT, '..');

/**
 * Side-channel slot the teardown reads. We can't return state from
 * globalSetup to globalTeardown directly through Playwright's API, so
 * env vars are the canonical bridge (Playwright preserves `process.env`
 * across the two hooks).
 */
const ENV_BASE_URL = 'LIVE_BFF_URL';
const ENV_FIXTURE_CWD = 'LIVE_BFF_FIXTURE_CWD';
const ENV_PORT = 'LIVE_BFF_PORT';

/**
 * Default-export shape Playwright understands: a function that returns
 * either `void` or a globalTeardown function. We split the two halves
 * into separate modules (this file + `global-teardown.ts`) so the config
 * can wire them independently — easier to reason about than a single
 * file with both responsibilities.
 */
export default async function globalSetup(): Promise<void> {
  // Fast-skip when the live-bff project isn't actually selected. We
  // detect this by checking PLAYWRIGHT_PROJECT_FILTER (set by Playwright
  // when --project is passed). When the user runs the static smoke
  // project alone, we don't need to spend ~5s booting a kernel.
  const projectFilter = process.env['PLAYWRIGHT_PROJECT_FILTER'] ?? '';
  const explicitOptOut = process.env['SKILL_MAP_E2E_SKIP_LIVE_BFF'] === '1';
  if (explicitOptOut) return;
  // PLAYWRIGHT_PROJECT_FILTER is a comma-separated list when multiple
  // projects are selected (or empty when none, meaning "all projects").
  // We boot the live BFF when:
  //   - filter is empty (run all projects → live-bff included), or
  //   - filter explicitly names live-bff.
  if (projectFilter !== '' && !projectFilter.split(',').includes('live-bff')) {
    return;
  }

  const fixture = createLiveBffFixture(REPO_ROOT);
  const server = await spawnLiveBff({
    repoRoot: REPO_ROOT,
    fixtureCwd: fixture.cwd,
  });

  process.env[ENV_BASE_URL] = server.baseUrl;
  process.env[ENV_FIXTURE_CWD] = fixture.cwd;
  process.env[ENV_PORT] = String(server.port);

  // Stash the shutdown handle on a globalThis slot so globalTeardown
  // can reach it. Env vars only carry strings; the actual process
  // handle has to live on the Node process itself.
  (globalThis as Record<string, unknown>)['__SKILL_MAP_LIVE_BFF__'] = server;
}
