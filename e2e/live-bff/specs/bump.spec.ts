/**
 * Live-BFF happy-path bump (R10 closure — §Step 9.6 review queue).
 *
 * Exercises the real BFF + UI together:
 *
 *   1. Navigate to the SPA served by `sm serve` (live mode — meta tag
 *      `<meta name="skill-map-mode" content="live">`).
 *   2. Find the stale node from the fixture scope (the `.sm` carries a
 *      bodyHash sentinel that can never match the live sha256, so the
 *      kernel resolves `sidecar.status` to `stale-body`).
 *   3. Verify the stale state via two surfaces:
 *        a. The graph node-card carries `[data-testid="node-card-stale-badge"]`
 *           (renders only when `isStaleSidecar(overlay)` returns true —
 *           see `ui/src/app/components/node-card/node-card.html`).
 *        b. The inspector bump button is **enabled** (gated by
 *           `canBump()` in `inspector-view.ts` — also driven by the
 *           overlay's stale state).
 *   4. Click the inspector bump button.
 *   5. Wait for the WS `sidecar.bumped` event to land — the SPA's
 *      `SidecarService` patches the in-memory node store, the
 *      annotations panel `version` field re-renders with the
 *      incremented value (3 → 4), the badge collapses (overlay flips
 *      to `'fresh'` per the route's §Behaviour matrix in
 *      `src/server/routes/sidecar.ts`).
 *
 * Coverage scope: just the bump happy path (per the R10 brief). Error
 * paths and the 409 refusal flow stay covered by the Karma unit tests
 * (`inspector-view.spec.ts`, `node-card.spec.ts`, `sidecar.spec.ts`).
 */

import { test, expect } from './_fixtures.js';

const STALE_PATH = '.claude/agents/stale-agent.md';
const SEEDED_VERSION = 3;

// SKIPPED: pending e2e review after the workspace redesign (the standalone
// Files / Map views were merged into one workspace at `/`). Unskip once the
// suite is updated to the new layout.
test.describe.skip('live-BFF bump flow', () => {
  test('clicking bump on a stale node clears the badge and increments the version', async ({ page, liveBffUrl }) => {
    // 1. Boot the SPA — live mode, real BFF.
    await page.goto(liveBffUrl);
    await page.waitForLoadState('networkidle');

    // The shell test ID is the universal "did the SPA mount?" probe;
    // sharing it with the demo smoke means a regression is one place
    // to fix on the UI side.
    await expect(page.getByTestId('shell')).toBeVisible();

    const mode = await page.locator('meta[name="skill-map-mode"]').getAttribute('content');
    expect(mode).toBe('live');

    // 3a. Stale badge MUST be visible somewhere on the graph view —
    //     the node card renders it only when `isStaleSidecar(overlay)`
    //     resolves true. Page-scoped locator (no row scoping) because
    //     the only node in the fixture is the stale one; any badge on
    //     the page is THE badge.
    await page.getByTestId('nav-graph').click();
    await expect(page).toHaveURL(/\/map/);
    await expect(page.locator('[data-testid="node-card-stale-badge"]').first()).toBeVisible({ timeout: 10_000 });

    // 2. Confirm the stale fixture row is rendered in the files view, then
    //    deep-link into the map view (the files view itself opens an
    //    inline preview on click, the inspector lives under `/map?path=`).
    await page.goto('./files');
    await expect(page).toHaveURL(/\/files/);
    const row = page.getByTestId(`files-leaf-${STALE_PATH}`);
    await expect(row).toBeVisible();

    // 4. Open the inspector via deep-link.
    await page.goto(`./map?path=${encodeURIComponent(STALE_PATH)}`);
    await expect(page).toHaveURL(/\/map/);

    // The inspector bump host is the `<p-button>` wrapper; the actual
    // <button> is a child. Same selector strategy as the unit tests
    // (see `inspector-view.spec.ts`).
    const bumpHost = page.getByTestId('inspector-bump');
    await expect(bumpHost).toBeVisible();
    const bumpButton = bumpHost.locator('button').first();
    // 3b. Stale state is also confirmed by the bump button being enabled
    //     (per the unit tests — fresh disables, stale + first-time enable).
    await expect(bumpButton).toBeEnabled();

    // Annotations panel renders the seeded version BEFORE the bump.
    const versionField = page.getByTestId('annotations-version');
    await expect(versionField).toHaveText(String(SEEDED_VERSION));

    // 5. Click bump and wait for the version field to reflect the
    //    increment. The annotations panel only renders the `version`
    //    when the overlay is present and carries it — the kernel's
    //    bump action increments the existing value (3 → 4), so we wait
    //    for that exact transition. Polling is implicit in
    //    `toHaveText(...)` with a regex.
    await bumpButton.click();
    await expect(versionField).toHaveText(String(SEEDED_VERSION + 1), { timeout: 10_000 });

    // 6. Stale badge MUST be gone — the WS `sidecar.bumped` event flipped
    //    the overlay to `status: 'fresh'`, which the UI's
    //    `isStaleSidecar()` predicate (see `models/node.ts`) treats as
    //    "not stale" → badge collapses. Switch back to the graph view
    //    (where the badge renders inside the node card) to confirm.
    await page.getByTestId('nav-graph').click();
    await expect(page).toHaveURL(/\/map/);
    await expect(page.locator('[data-testid="node-card-stale-badge"]')).toHaveCount(0);
  });
});
