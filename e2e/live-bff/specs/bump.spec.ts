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
 *   3. Verify the stale state via three surfaces:
 *        a. The files rail row carries a `.files__stale-icon` (`pi-clock`)
 *           — the rail's per-row staleness signal (the graph node-card no
 *           longer ships a discrete `node-card-stale-badge`; staleness now
 *           surfaces on the rail row and in the inspector header).
 *        b. The inspector header shows `[data-testid="inspector-stale-badge"]`.
 *        c. The inspector bump button is **enabled** (gated by `canBump()`).
 *   4. Click the inspector bump button and accept the first-time
 *      `allowEditSmFiles` consent dialog (the BFF answers the first
 *      `POST /api/sidecar/bump` with 412 `confirm-required`; the UI opens
 *      the PrimeNG confirm dialog, "Yes, allow" retries the write).
 *   5. Wait for the WS `sidecar.bumped` event to land — the SPA's
 *      `SidecarService` patches the in-memory node store, the annotations
 *      panel `version` field re-renders with the incremented value
 *      (v3 → v4), the stale badge collapses (overlay flips to `'fresh'`
 *      per the route's §Behaviour matrix in `src/server/routes/sidecar.ts`).
 *
 * Coverage scope: just the bump happy path (per the R10 brief). Error
 * paths and the 409 refusal flow stay covered by the Karma unit tests
 * (`inspector-view.spec.ts`, `node-card.spec.ts`, `sidecar.spec.ts`).
 */

import { test, expect } from './_fixtures.js';

const STALE_PATH = '.claude/agents/stale-agent.md';
const SEEDED_VERSION = 3;
const CONSENT_ACCEPT_LABEL = 'Yes, allow';

test.describe('live-BFF bump flow', () => {
  test('clicking bump on a stale node clears the badge and increments the version', async ({ page, liveBffUrl }) => {
    // 1. Boot the SPA — live mode, real BFF.
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
    const staleRow = page.getByTestId(`files-leaf-${STALE_PATH}`);
    await expect(staleRow).toBeVisible();
    await expect(staleRow.locator('.files__stale-icon')).toBeVisible();

    // 4. Open the inspector via the shared `?path=` deep-link (no `/map`
    //    route anymore — selection lives on the workspace route).
    await page.goto(`${liveBffUrl}?path=${encodeURIComponent(STALE_PATH)}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('inspector-view')).toBeVisible();

    // 3b. Stale state in the inspector header.
    await expect(page.getByTestId('inspector-stale-badge')).toBeVisible();

    // 3c. The inspector bump host is the `<p-button>` wrapper; the actual
    //     <button> is a child. Same selector strategy as the unit tests
    //     (see `inspector-view.spec.ts`). Stale state is also confirmed by
    //     the bump button being enabled (fresh disables, stale enables).
    const bumpButton = page.getByTestId('inspector-bump').locator('button').first();
    await expect(bumpButton).toBeEnabled();

    // Annotations panel renders the seeded version (with a `v` prefix)
    // BEFORE the bump.
    const versionField = page.getByTestId('annotations-version');
    await expect(versionField).toHaveText(`v${SEEDED_VERSION}`);

    // 5. Click bump, then accept the first-time `.sm`-write consent. The
    //    first `POST /api/sidecar/bump` returns 412 `confirm-required`
    //    (`allowEditSmFiles`), which opens the consent dialog; "Yes, allow"
    //    grants the permission and the UI retries the write.
    await bumpButton.click();
    const consentAccept = page.getByRole('button', { name: CONSENT_ACCEPT_LABEL });
    await consentAccept.waitFor({ timeout: 5_000 });
    await consentAccept.click();

    // Wait for the version field to reflect the increment (v3 → v4). The
    // annotations panel only renders the `version` when the overlay is
    // present and carries it — the kernel's bump action increments the
    // existing value, so we wait for that exact transition. Polling is
    // implicit in `toHaveText(...)`.
    await expect(versionField).toHaveText(`v${SEEDED_VERSION + 1}`, { timeout: 10_000 });

    // 6. Stale signals MUST be gone — the WS `sidecar.bumped` event flipped
    //    the overlay to `status: 'fresh'`, which the UI's `isStaleSidecar()`
    //    predicate treats as "not stale". The inspector stale badge
    //    collapses and the rail row's stale-clock icon clears.
    await expect(page.getByTestId('inspector-stale-badge')).toHaveCount(0);
    await expect(page.locator('.files__stale-icon')).toHaveCount(0);
  });
});
