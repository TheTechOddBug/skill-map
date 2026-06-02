import { expect, test } from '@playwright/test';

/**
 * Step 9.6.5 — UI sidecar surface smoke tests (demo-mode harness).
 *
 * Scope note (Decision #7 / e2e harness limitation): the existing e2e
 * workspace runs against the **static demo bundle** at `/demo/`, which
 * deliberately never calls `/api/`. There is therefore no live BFF in
 * this harness and no way to drive a real bump request to completion.
 * What we CAN cover here:
 *
 *   - Bump button surface: the button MUST be present in the inspector
 *     header when a node is selected. Per Decision #3, the button is
 *     disabled when the sidecar status is `'fresh'` and enabled in
 *     "first-time creation" state. The assertion here is presence,
 *     not the enabled/disabled flavour (covered by unit tests).
 *   - Filter surface: the `Stale only` filter chip MUST be present in
 *     the filter bar; toggling it SHOULD apply a client-side filter.
 *   - Annotations card: nodes with no sidecar overlay MUST NOT show the
 *     annotations card (it gates on `node.sidecar?.present`). After the
 *     Step 9.6 fixture migration, `README.md` is the only demo-bundle
 *     node without a sidecar, so the test targets it by path.
 *
 * Happy-path bump (stale → click → badge clears, version increments) and
 * the 409 error envelope path live in the Karma/Vitest unit tests
 * (`inspector-view.spec.ts`, `node-card.spec.ts`, `sidecar.spec.ts`)
 * because the demo harness can't drive the live BFF. Wiring a Playwright
 * test against `sm serve` (live BFF) is a follow-up — the e2e harness
 * does not boot the kernel today.
 */

// SKIPPED: pending e2e review after the workspace redesign (the standalone
// Files / Map views were merged into one workspace at `/`). Unskip once the
// suite is updated to the new layout.
test.describe.skip('sidecar UI surface (Step 9.6.5)', () => {
  test('files view exposes the "Stale only" filter chip', async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');
    await page.goto('./files');
    await expect(page).toHaveURL(/\/files/);

    const staleFilter = page.getByTestId('filter-stale-only');
    await expect(staleFilter).toBeVisible();
  });

  test('toggling "Stale only" updates the URL filter param', async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');
    await page.goto('./files');
    await expect(page).toHaveURL(/\/files/);

    const staleFilter = page.getByTestId('filter-stale-only');
    await staleFilter.click();

    // FilterUrlSyncService writes the staleOnly flag to the URL.
    await expect(page).toHaveURL(/staleOnly=true/);
  });

  test('inspector bump button is rendered when a node is selected', async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');

    // Pick the first leaf path from the files view, then deep-link into
    // the map view with `?path=<path>` to open the inspector. The files
    // view itself only renders an inline preview on row click; the
    // inspector lives under `/map?path=`.
    await page.goto('./files');
    await expect(page).toHaveURL(/\/files/);
    const firstRow = page.locator('[data-testid^="files-leaf-"]').first();
    if ((await firstRow.count()) === 0) {
      test.skip(true, 'demo bundle has no nodes to open');
      return;
    }
    const firstPath = (await firstRow.getAttribute('data-testid'))!.replace(/^files-leaf-/, '');
    await page.goto(`./map?path=${encodeURIComponent(firstPath)}`);
    await expect(page).toHaveURL(/\/map/);

    // The bump button lives inside the inspector header. After the
    // Step 9.6 fixture migration, `.claude/**` demo nodes ship with
    // `status: 'fresh'` overlays (button disabled per Decision #3) and
    // `README.md` ships with no overlay (button enabled, "first-time
    // creation" state). What we assert here is presence; the
    // enabled/disabled state is covered in `inspector-view.spec.ts`.
    const bumpHost = page.getByTestId('inspector-bump');
    await expect(bumpHost).toBeVisible();
  });

  test('inspector annotations card is hidden for nodes without a sidecar overlay', async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');

    // Post Step 9.6 fixture migration the demo bundle ships sidecars
    // for every `.claude/**` node; only the top-level `README.md` is
    // left as the canonical "no sidecar overlay" case, so deep-link
    // directly into the map view with the README path.
    await page.goto('./map?path=README.md');
    await expect(page).toHaveURL(/\/map/);

    // README has `sidecar.present === false` — annotations card MUST
    // collapse (it gates on `node.sidecar?.present`).
    await expect(page.getByTestId('inspector-card-annotations')).toHaveCount(0);
  });
});
