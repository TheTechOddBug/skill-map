/**
 * Reserved-slot regression: `graph.node.alert`.
 *
 * Background: under the prior contract every "this node has a problem"
 * finding (`reference-broken`, `annotation-field-unknown`,
 * `schema-violation`) emitted to TWO surfaces, a footer chip on
 * `card.footer.right` and a corner badge on `graph.node.alert`. The
 * corner became visual noise (three analyzers competing for one
 * decoration, the chip already carried the count + tooltip), so the
 * slot was reserved for genuinely independent signals and every
 * built-in core analyzer was disconnected from it.
 *
 * This spec locks the new contract end-to-end: given a fixture node
 * with a broken `@mention` (the textbook reference-broken case that
 * USED to light up the corner), the SPA must render zero
 * `<sm-node-alert>` elements on the graph view, while the footer
 * `<sm-node-counter>` chip MUST still surface. If a future change
 * re-wires any built-in analyzer to the corner, the
 * `renderer-node-alert` count will rise and this test fails.
 *
 * Unit specs under `src/plugins/core/analyzers/*\/__tests__/` already
 * assert the analyzer manifests carry only the chip slot; this e2e
 * complements them by exercising the full pipeline (BFF → DataSource
 * → graph render) so a regression in the contribution payload, the
 * slot-host filter, or the renderer registration would surface here.
 */

import { test, expect } from './_fixtures.js';

const STALE_PATH = '.claude/agents/stale-agent.md';

// SKIPPED: pending e2e review after the workspace redesign (the standalone
// Files / Map views were merged into one workspace at `/`). Unskip once the
// suite is updated to the new layout.
test.describe.skip('graph.node.alert (reserved slot, no built-in emitters)', () => {
  test('renders zero corner badges even on nodes with reference-broken findings', async ({ page, liveBffUrl }) => {
    await page.goto(liveBffUrl);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('shell')).toBeVisible();
    await page.getByTestId('nav-graph').click();
    await expect(page).toHaveURL(/\/map/);

    // Confirm the fixture node mounted before asserting absence on a
    // dependent surface, otherwise a "no badges" pass could just mean
    // "no graph yet". The stale-agent card carries the `data-testid`
    // mirror of its path (see `graph-view.html`).
    const stale = page.getByTestId(`graph-node-${STALE_PATH}`);
    await expect(stale).toBeVisible({ timeout: 10_000 });

    // 1. Corner contract: no `<sm-node-alert>` anywhere on the graph.
    //    The slot's host is still mounted (per `graph-view.html`); it
    //    just receives no contributions because every built-in analyzer
    //    dropped the alert ui declaration. The renderer test ID is
    //    declared on the `<sm-node-alert>` root in
    //    `ui/src/app/renderers/node-alert/node-alert.ts`.
    await expect(page.locator('[data-testid="renderer-node-alert"]')).toHaveCount(0);

    // 2. Footer chip survives: reference-broken still emits to
    //    `card.footer.right`, and the host renders `<sm-node-counter>`.
    //    The fixture's broken `@nonexistent-handle` is a single
    //    unresolved trigger from stale-agent, so the chip surfaces on
    //    that exact card.
    const chip = stale.locator('[data-testid="renderer-node-counter"]').first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
  });
});
