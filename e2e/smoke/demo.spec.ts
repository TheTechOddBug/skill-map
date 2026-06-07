import { expect, test } from '@playwright/test';

/**
 * Demo bundle smoke test (ROADMAP §Step 14.7).
 *
 * The demo bundle is a static deployable that ships under `web/demo/`
 * and is served via the public site (skill-map.ai/demo/). It MUST work
 * standalone — no `sm` install, no kernel server, no /api/ traffic.
 *
 * The hard guarantee this suite enforces: a regression that re-introduces
 * a network call to `/api/...` from the demo bundle (e.g. a future
 * DataSource refactor accidentally activating `RestDataSource` under
 * `MODE === 'demo'`) is caught here, not in production.
 *
 * Server: deps-free Node static server (`web/scripts/serve-demo.js`)
 * managed by Playwright's `webServer` config. Mount: `/demo/`.
 *
 * Workspace redesign note: the standalone `/files` and `/map` routes and
 * their topbar nav tabs (`nav-files` / `nav-graph`) were retired. The app
 * is now a single fused workspace at `/`: a files tree rail on the left
 * (`files-view`) and the map canvas in the center (`workspace-view`).
 * These tests target that single screen.
 */

test.describe('demo bundle', () => {
  // The fused workspace opens with the files rail collapsed (map-first by
  // default: `sm.workspace.rail-collapsed` absent => collapsed). Seed the
  // persisted OPEN state before each navigation so the `files-view` /
  // `files-table` assertions below find the rail expanded.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('sm.workspace.rail-collapsed', '0');
      } catch {
        /* localStorage unavailable before first paint; ignore. */
      }
    });
  });

  test('boots without console errors and runs in demo mode', async ({ page }) => {
    const consoleErrors: string[] = [];
    // Track failed network requests so we can filter the bare
    // "Failed to load resource:" console errors against their origin.
    // The browser logs the message without the URL; we correlate via
    // a parallel `requestfailed` listener and ignore third-party
    // assets we don't ship (Google Fonts, etc.) — those depend on the
    // tester's network and are not part of the demo bundle's contract.
    const externalFailures = new Set<string>();
    page.on('requestfailed', (req) => {
      const url = req.url();
      if (isExternalAsset(url)) externalFailures.add(req.failure()?.errorText ?? '');
    });
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Drop the generic "Failed to load resource: <code>" line when
      // the matching `<code>` came from an external asset failure.
      // We can't match by URL because the console message omits it.
      if (
        text.startsWith('Failed to load resource:') &&
        [...externalFailures].some((errText) => text.includes(errText))
      ) {
        return;
      }
      consoleErrors.push(text);
    });

    await page.goto('./');
    await page.waitForLoadState('networkidle');

    const mode = await page.locator('meta[name="skill-map-mode"]').getAttribute('content');
    expect(mode).toBe('demo');

    const shell = page.getByTestId('shell');
    await expect(shell).toBeVisible();

    // The fused workspace is the only view. Both halves (files rail + map)
    // mount on the single `/` route.
    await expect(page.getByTestId('workspace-view')).toBeVisible();
    await expect(page.getByTestId('files-view')).toBeVisible();

    expect(
      consoleErrors,
      `Demo bundle logged console errors:\n${consoleErrors.join('\n')}`,
    ).toEqual([]);
  });

  test('does not call any /api/* endpoint', async ({ page }) => {
    // Capture every network request before navigation. Playwright fires
    // `request` for every fetch the page issues — including XHR, fetch,
    // and EventSource. We assert no path under `/api/` shows up.
    const apiCalls: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith('/api/')) apiCalls.push(req.url());
    });

    await page.goto('./');
    await page.waitForLoadState('networkidle');

    // Exercise the workspace interactions a regression could leak through:
    // selecting a file row writes `?path=`, which opens the floating
    // inspector and loads the node body. A DataSource that leaked into
    // demo mode would fire `/api/scan`, `/api/nodes`, `/api/nodes/<p>/body`,
    // etc. on selection. Drive a real selection so the body-load path runs.
    await expect(page.getByTestId('files-table')).toBeVisible();
    const firstLeaf = page.locator('[data-testid^="files-leaf-"]').first();
    await firstLeaf.click();
    await expect(page).toHaveURL(/[?&]path=/);
    await expect(page.getByTestId('inspector-view')).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(
      apiCalls,
      `Demo bundle fetched live-mode endpoints — DataSource leaked into demo:\n${apiCalls.join('\n')}`,
    ).toEqual([]);
  });

  test('renders the fused workspace (files rail + map) on the single route', async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');

    // Single workspace route: no more `/files` / `/map` destinations.
    // The files rail and the map canvas share one screen.
    await expect(page.getByTestId('workspace-view')).toBeVisible();
    await expect(page.getByTestId('workspace-rail')).toBeVisible();
    await expect(page.getByTestId('files-view')).toBeVisible();
    await expect(page.getByTestId('files-table')).toBeVisible();

    // Selecting a file row opens the floating inspector in the same view
    // (selection syncs through the `?path=` query param — there is no
    // route change, the inspector is part of the workspace).
    const firstLeaf = page.locator('[data-testid^="files-leaf-"]').first();
    await firstLeaf.click();
    await expect(page).toHaveURL(/[?&]path=/);
    await expect(page.getByTestId('inspector-view')).toBeVisible();
  });
});

/**
 * `true` for assets the demo bundle doesn't ship — Google Fonts,
 * Anthropic CDN icons, etc. — so a network-restricted test environment
 * (Playwright headless behind a firewall, sandboxed sub-shell, CI
 * runner without egress) doesn't fail the smoke suite over noise the
 * demo neither owns nor controls.
 */
function isExternalAsset(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname === 'fonts.gstatic.com') return true;
    if (u.hostname === 'fonts.googleapis.com') return true;
    return false;
  } catch {
    return false;
  }
}
