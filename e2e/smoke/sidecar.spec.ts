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
 *     disabled only when the sidecar status is `'fresh'`; demo-bundle
 *     nodes ship no overlay, which is the "first-time creation" state
 *     and the button is enabled — so the assertion here is presence,
 *     not the disabled flavour.
 *   - Filter surface: the `Stale only` filter chip MUST be present in
 *     the filter bar; toggling it SHOULD apply a client-side filter.
 *   - Annotations card: nodes with no sidecar overlay MUST NOT show the
 *     annotations card (it gates on `node.sidecar?.present`).
 *
 * Happy-path bump (stale → click → badge clears, version increments) and
 * the 409 error envelope path live in the Karma/Vitest unit tests
 * (`inspector-view.spec.ts`, `node-card.spec.ts`, `sidecar.spec.ts`)
 * because the demo harness can't drive the live BFF. Wiring a Playwright
 * test against `sm serve` (live BFF) is a follow-up — the e2e harness
 * does not boot the kernel today.
 */

test.describe('sidecar UI surface (Step 9.6.5)', () => {
  test('list view exposes the "Stale only" filter chip', async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-list').click();
    await expect(page).toHaveURL(/\/list/);

    const staleFilter = page.getByTestId('filter-stale-only');
    await expect(staleFilter).toBeVisible();
  });

  test('toggling "Stale only" updates the URL filter param', async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-list').click();
    await expect(page).toHaveURL(/\/list/);

    const staleFilter = page.getByTestId('filter-stale-only');
    await staleFilter.click();

    // FilterUrlSyncService writes the staleOnly flag to the URL.
    await expect(page).toHaveURL(/staleOnly=true/);
  });

  test('inspector bump button is rendered when a node is selected', async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('nav-list').click();
    await expect(page).toHaveURL(/\/list/);

    const firstRow = page.locator('[data-testid^="list-row-"]').first();
    if ((await firstRow.count()) === 0) {
      test.skip(true, 'demo bundle has no nodes to open');
      return;
    }
    await firstRow.click();
    await expect(page).toHaveURL(/\/graph/);

    // The bump button lives inside the inspector header. Demo-bundle
    // nodes ship without a sidecar overlay → "first-time creation"
    // state → button is enabled (per Decision #3). What we assert
    // here is presence; the disabled-on-fresh path is covered in
    // `inspector-view.spec.ts` (unit).
    const bumpHost = page.getByTestId('inspector-bump');
    await expect(bumpHost).toBeVisible();
  });

  test('inspector annotations card is hidden for nodes without a sidecar overlay', async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('nav-list').click();
    await expect(page).toHaveURL(/\/list/);

    const firstRow = page.locator('[data-testid^="list-row-"]').first();
    if ((await firstRow.count()) === 0) {
      test.skip(true, 'demo bundle has no nodes to open');
      return;
    }
    await firstRow.click();
    await expect(page).toHaveURL(/\/graph/);

    // Demo bundle nodes ship without sidecars — annotations card MUST
    // collapse (it gates on `node.sidecar?.present`).
    await expect(page.getByTestId('inspector-card-annotations')).toHaveCount(0);
  });
});
