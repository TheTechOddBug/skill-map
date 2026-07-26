/**
 * Live-BFF happy-path bump (R10 closure — §Step 9.6 review queue).
 *
 * Exercises the real BFF + UI together inside the fused workspace:
 *
 *   1. Navigate to the SPA served by `sm serve` (live mode — meta tag
 *      `<meta name="skill-map-mode" content="live">`). The app is a single
 *      workspace at `/`: a files tree rail on the left, the map canvas in
 *      the center, and a floating inspector that opens via the shared
 *      `?path=` query param. The former `/map` / `/files` routes and the
 *      `nav-graph` / `nav-files` topbar tabs are gone.
 *   2. Find the stale node from the fixture scope (the `.sm` carries a
 *      bodyHash sentinel that can never match the live sha256, so the
 *      kernel resolves `sidecar.status` to `stale-both`).
 *   3. Verify the stale state via two surfaces:
 *        a. The files rail row carries a `.files__stale-icon` (`pi-clock`),
 *           the rail's per-row staleness signal.
 *        b. The header version chip (the Bump affordance since 2026-07-21;
 *           `core/node-bump` is opted in by the fixture because it ships
 *           `defaultEnabled: false`) renders the seeded version enabled.
 *   4. Click the version chip and accept the first-time `allowEditSmFiles`
 *      consent dialog (the BFF answers the first
 *      `POST /api/actions/core/node-bump` with 412 `confirm-required`; the
 *      UI opens the consent dialog, "Allow" retries the write).
 *   5. Wait for the WS `action.applied` event to land: the SPA patches the
 *      in-memory node store, the version chip re-renders with the
 *      incremented value (v3 -> v4) and the rail stale icon clears (the
 *      overlay flips to `'fresh'`).
 *
 * Coverage scope: just the bump happy path (per the R10 brief). Error
 * paths and the 409 refusal flow stay covered by the Karma unit tests
 * (`inspector-view.spec.ts`, `node-card.spec.ts`, `sidecar.spec.ts`).
 */

import { test, expect } from './_fixtures.js';
import { expectSingleViewport } from '../../smoke/_files-rail.js';

const STALE_PATH = '.claude/agents/stale-agent.md';
const SEEDED_VERSION = 3;
const CONSENT_ACCEPT_LABEL = 'Allow';

test.describe('live-BFF bump flow', () => {
  test('clicking bump on a stale node clears the badge and increments the version', async ({ page, liveBffUrl }) => {
    // 1. Boot the SPA (live mode, real BFF). The files rail opens
    //    collapsed map-first by default; seed the persisted OPEN state so
    //    `files-view` mounts on load (same recipe as the demo smoke).
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('sm.workspace.rail-collapsed', '0');
      } catch {
        /* localStorage unavailable before first paint; ignore. */
      }
    });
    await page.goto(liveBffUrl);
    await page.waitForLoadState('networkidle');

    // The shell test ID is the universal "did the SPA mount?" probe;
    // sharing it with the demo smoke means a regression is one place
    // to fix on the UI side.
    await expect(page.getByTestId('shell')).toBeVisible();
    await expect(page.getByTestId('workspace-view')).toBeVisible();

    const mode = await page.locator('meta[name="skill-map-mode"]').getAttribute('content');
    expect(mode).toBe('live');

    // 2. Confirm the stale fixture node mounted on the map (the only node
    //    in the fixture is the stale one). The graph node-card carries a
    //    `data-testid` mirror of its path.
    await expect(page.getByTestId(`graph-node-${STALE_PATH}`)).toBeVisible({ timeout: 10_000 });

    // 3a. Stale surface on the files rail: the row for a `stale-*` node
    //     renders the stale-clock icon. This replaces the retired
    //     `node-card-stale-badge` as the graph-side staleness signal.
    //     Folders render COLLAPSED by default; expand the whole tree so
    //     the nested leaf row mounts (same recipe as the demo smoke).
    await page.getByTestId('files-expand-all').click();
    //     The rail is virtualised, so a specific nested row is only in the
    //     DOM while it is inside the render window; this fixture fits one
    //     viewport, and the check below fails loudly if that stops holding.
    await expectSingleViewport(page);
    const staleRow = page.getByTestId(`files-leaf-${STALE_PATH}`);
    await expect(staleRow).toBeVisible();
    await expect(staleRow.locator('.files__stale-icon')).toBeVisible();

    // 4. Open the inspector via the shared `?path=` deep-link (no `/map`
    //    route anymore — selection lives on the workspace route).
    await page.goto(`${liveBffUrl}?path=${encodeURIComponent(STALE_PATH)}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('inspector-view')).toBeVisible();

    // 3b/3c. The Bump affordance IS the header version chip (user call
    //     2026-07-21, mirror of the stability chip): it renders because
    //     the fixture opts `core/node-bump` in, shows the seeded version,
    //     and is enabled because the node is stale (drift present).
    const versionChip = page.getByTestId('inspector-version');
    await expect(versionChip).toBeVisible();
    await expect(versionChip).toHaveText(`v${SEEDED_VERSION}`);
    await expect(versionChip).toBeEnabled();

    // 5. Click the chip, then accept the first-time `.sm`-write consent.
    //    The first `POST /api/actions/core/node-bump` answers 412
    //    `confirm-required` (`allowEditSmFiles`); the UI opens the consent
    //    dialog and "Allow" retries the write (one-shot grant).
    await versionChip.click();
    const consentAccept = page.getByRole('button', { name: CONSENT_ACCEPT_LABEL, exact: true });
    await consentAccept.waitFor({ timeout: 5_000 });
    await consentAccept.click();

    // Wait for the chip to reflect the increment (v3 -> v4). The WS
    //    `action.applied` broadcast patches the node store and the chip
    //    re-derives the effective version. Polling is implicit in
    //    `toHaveText(...)`.
    await expect(versionChip).toHaveText(`v${SEEDED_VERSION + 1}`, { timeout: 10_000 });

    // 6. Stale signals MUST be gone: the bump refreshed the identity
    //    hashes, the overlay flips to `'fresh'`, and the rail row's
    //    stale-clock icon clears (the header stale badge is a
    //    contribution-driven icon-only renderer now, the rail icon is
    //    the stable staleness probe).
    await expect(page.locator('.files__stale-icon')).toHaveCount(0);
  });
});
