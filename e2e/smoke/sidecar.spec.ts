import { expect, test } from '@playwright/test';

import { expectSingleViewport } from './_files-rail.js';

/**
 * Step 9.6.5 — UI sidecar surface smoke tests (demo-mode harness).
 *
 * Scope note (Decision #7 / e2e harness limitation): the existing e2e
 * workspace runs against the **static demo bundle** at `/demo/`, which
 * deliberately never calls `/api/`. There is therefore no live BFF in
 * this harness and no way to drive a real bump request to completion.
 *
 * Workspace redesign note: the standalone `/files` and `/map` routes were
 * fused into one workspace at `/` (files tree rail on the left, map +
 * floating inspector in the center). The old standalone files-page
 * `sm-filter-bar` toolbar was removed, so the `filter-stale-only` chip no
 * longer exists in the UI (the `staleOnly` filter survives only as a
 * `FilterStoreService` capability + `?staleOnly=` URL param, with no rail
 * affordance to toggle it). The two former "Stale only filter chip" cases
 * are therefore replaced by the closest workspace equivalent: the rail
 * surfaces per-node sidecar staleness via a `pi-clock` icon on the row.
 *
 * What we CAN still cover here:
 *
 *   - Stale surface: the files rail row for a `stale-*` node MUST render
 *     the stale-clock icon (`files__stale-icon`), the rail's replacement
 *     for the removed filter chip as the "UI surfaces staleness" signal.
 *   - Sidecar action surface: the surfaces re-homed from action-button
 *     contributions each follow their plugin (2026-07-21 enabled-gate
 *     sweep). With the demo fixture's default toggles, the tag row
 *     (`core/node-set-tags`, enabled by default) renders for a selected
 *     node while the stability and version chips (`core/node-set-stability`
 *     / `core/node-bump`, `defaultEnabled: false`, no opt-in in the
 *     fixture) stay absent. Presence only; the dispatch flows are
 *     covered by unit tests (the demo bundle is read-only anyway).
 *   - Annotations card: nodes with no sidecar overlay MUST NOT show the
 *     annotations card (it gates on `n.sidecar?.present`). In the current
 *     demo bundle `docs/STYLE.md` is the canonical "no sidecar overlay"
 *     case (a plain doc that was never annotated), so the test targets it
 *     by path.
 *
 * Happy-path bump (stale → click → badge clears, version increments) and
 * the 409 error envelope path live in the Karma/Vitest unit tests
 * (`inspector-view.spec.ts`, `node-card.spec.ts`, `sidecar.spec.ts`) and
 * in the live-BFF Playwright suite (`live-bff/specs/bump.spec.ts`),
 * because the demo harness can't drive the live BFF.
 */

const STALE_PATH = '.claude/agents/content-editor.md';
const NO_SIDECAR_PATH = 'docs/STYLE.md';

async function gotoWorkspace(page: import('@playwright/test').Page): Promise<void> {
  // The files rail opens collapsed map-first by default; seed the
  // persisted OPEN state so `files-view` / `files-table` mount on load.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('sm.workspace.rail-collapsed', '0');
    } catch {
      /* localStorage unavailable before first paint; ignore. */
    }
  });
  await page.goto('./');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('files-view')).toBeVisible();
  await expect(page.getByTestId('files-table')).toBeVisible();
}

test.describe('sidecar UI surface (Step 9.6.5)', () => {
  test('the files rail surfaces sidecar staleness on a stale node row', async ({ page }) => {
    // Replaces the removed `filter-stale-only` chip cases: the rail no
    // longer carries a stale filter toggle, but it DOES flag staleness
    // per row. The demo bundle ships `content-editor.md` with a
    // `stale-both` sidecar, so its row must render the stale clock icon.
    await gotoWorkspace(page);

    // Folders now render COLLAPSED by default, so a nested leaf row is not
    // mounted until its ancestor folders are open. Expand the whole tree
    // (the rail's expand-all control) to surface `content-editor.md`.
    await page.getByTestId('files-expand-all').click();
    // The rail is virtualised: an expanded row is only in the DOM while it
    // sits inside the render window. Asserting a SPECIFIC nested row is
    // visible therefore assumes the whole corpus fits one viewport, which
    // holds for the demo dataset. Pin it so a grown fixture fails here
    // naming its own cause instead of looking like a sidecar regression.
    await expectSingleViewport(page);

    const row = page.getByTestId(`files-leaf-${STALE_PATH}`);
    await expect(row).toBeVisible();
    await expect(row.locator('.files__stale-icon')).toBeVisible();
  });

  test('inspector renders the contribution-gated sidecar action surface when a node is selected', async ({ page }) => {
    await gotoWorkspace(page);

    // Inspector action surfaces are plugin contributions to the
    // `inspector.action.button` slot, self-projected by an Action's
    // scan-time `project(ctx)`, and each surface follows its plugin
    // (2026-07-21 enabled-gate sweep). In the default demo bundle:
    //   - `core/node-set-tags` is enabled by default and projects on
    //     every real node, so its re-homed surface, the inline tag row,
    //     MUST render (this is the end-to-end proof that an action's
    //     projection reaches the UI gate).
    //   - `core/node-set-stability` and `core/node-bump` ship
    //     `defaultEnabled: false` and the demo fixture carries no opt-in,
    //     so their re-homed header surfaces (stability chip, version
    //     chip) MUST be absent, a disabled extension leaves no surface.
    // Deep-link to the demo node via the shared `?path=` query param
    // (there is no `/map` route anymore).
    await page.goto(`./?path=${encodeURIComponent(STALE_PATH)}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('inspector-view')).toBeVisible();

    await expect(page.getByTestId('node-tags')).toBeVisible();
    await expect(page.getByTestId('inspector-stability-tag')).toHaveCount(0);
    await expect(page.getByTestId('inspector-version')).toHaveCount(0);
  });

  test('inspector annotations card is hidden for nodes without a sidecar overlay', async ({ page }) => {
    // Deep-link straight into the workspace selection via `?path=`.
    // `docs/STYLE.md` ships no sidecar overlay, so the annotations card
    // (which gates on `n.sidecar?.present`) must collapse.
    await page.goto(`./?path=${encodeURIComponent(NO_SIDECAR_PATH)}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('inspector-view')).toBeVisible();
    await expect(page.getByTestId('inspector-card-annotations')).toHaveCount(0);
  });
});
