/**
 * Map scope overrides, end-to-end (`spec/cli-contract.md` §Map scope
 * overrides): the deviation-model rail checkboxes against a REAL
 * `sm serve` (browser -> `/api/branch` with `exclude=` / `excludeRoot=`
 * -> SQL evaluation -> graph render). The unit and route suites pin
 * each layer in isolation; this is the only place the full loop runs.
 *
 * Contract locked here:
 *   1. Every checkbox starts CHECKED (no overrides = whole corpus on
 *      the map).
 *   2. Unchecking a folder hides its subtree from the CANVAS (the
 *      server re-scopes the branch; nothing is filtered client-side)
 *      while the rest of the map survives; re-checking restores it.
 *   3. The master header checkbox excludes the root: the map empties
 *      into the curation empty state, whose "Show all" button clears
 *      every override.
 *
 * The files rail defaults to collapsed for a small corpus, so each test
 * seeds `sm.workspace.rail-collapsed = '0'` before the SPA boots (the
 * same knob the workspace unit specs use).
 */

import { test, expect } from './_fixtures.js';

const STALE_PATH = '.claude/agents/stale-agent.md';
const DOCS_GUIDE = 'docs/guide.md';
const DOCS_API = 'docs/api.md';

test.describe('map scope overrides (rail checkboxes -> /api/branch -> canvas)', () => {
  test.beforeEach(async ({ page, liveBffUrl }) => {
    await page.addInitScript(() => {
      localStorage.setItem('sm.workspace.rail-collapsed', '0');
    });
    await page.goto(liveBffUrl);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('workspace-view')).toBeVisible();
    // The whole corpus renders before any gesture (fixture nodes from
    // two different folders).
    await expect(page.getByTestId(`graph-node-${STALE_PATH}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`graph-node-${DOCS_GUIDE}`)).toBeVisible({ timeout: 10_000 });
  });

  test('checkboxes start checked and unchecking a folder hides its subtree from the map', async ({ page }) => {
    const master = page.getByTestId('files-vis-root');
    const docsBox = page.getByTestId('files-vis-folder-docs');
    await expect(master).toHaveAttribute('data-state', 'all');
    await expect(docsBox).toHaveAttribute('data-state', 'all');

    // Uncheck `docs`: the loader debounce-fetches the scoped branch and
    // the canvas drops both docs nodes; the agent node survives.
    await docsBox.click();
    await expect(page.getByTestId(`graph-node-${DOCS_GUIDE}`)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId(`graph-node-${DOCS_API}`)).toHaveCount(0);
    await expect(page.getByTestId(`graph-node-${STALE_PATH}`)).toBeVisible();
    await expect(docsBox).toHaveAttribute('data-state', 'none');
    await expect(master).toHaveAttribute('data-state', 'some');
    // An active scope surfaces the toolbar "Show all" escape hatch.
    await expect(page.getByTestId('graph-show-all-toolbar')).toBeVisible();

    // Re-check: the subtree returns and the scope goes back to
    // show-all (override deleted, toolbar button gone).
    await docsBox.click();
    await expect(page.getByTestId(`graph-node-${DOCS_GUIDE}`)).toBeVisible({ timeout: 10_000 });
    await expect(master).toHaveAttribute('data-state', 'all');
    await expect(page.getByTestId('graph-show-all-toolbar')).toHaveCount(0);
  });

  test('master uncheck empties the map into the curation empty state; Show all restores', async ({ page }) => {
    const master = page.getByTestId('files-vis-root');
    await master.click();

    // Root excluded: the canvas empties and the curation empty state
    // (with its own "Show all on map" button) takes over.
    await expect(page.getByTestId(`graph-node-${STALE_PATH}`)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId(`graph-node-${DOCS_GUIDE}`)).toHaveCount(0);
    await expect(master).toHaveAttribute('data-state', 'none');
    const showAll = page.getByTestId('graph-show-all-on-map');
    await expect(showAll).toBeVisible({ timeout: 10_000 });

    // "Show all" clears every override: full corpus back, master checked.
    await showAll.click();
    await expect(page.getByTestId(`graph-node-${STALE_PATH}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`graph-node-${DOCS_GUIDE}`)).toBeVisible();
    await expect(master).toHaveAttribute('data-state', 'all');
  });

  test('master uncheck + re-check one folder curates the map to that subtree', async ({ page }) => {
    await page.getByTestId('files-vis-root').click();
    await expect(page.getByTestId(`graph-node-${DOCS_GUIDE}`)).toHaveCount(0, { timeout: 10_000 });

    // The curation workflow: check `docs` under the excluded root.
    await page.getByTestId('files-vis-folder-docs').click();
    await expect(page.getByTestId(`graph-node-${DOCS_GUIDE}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`graph-node-${DOCS_API}`)).toBeVisible();
    // The agent node stays excluded (its nearest override is the root).
    await expect(page.getByTestId(`graph-node-${STALE_PATH}`)).toHaveCount(0);
    await expect(page.getByTestId('files-vis-root')).toHaveAttribute('data-state', 'some');
  });
});
