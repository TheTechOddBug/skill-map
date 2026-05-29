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
 */

test.describe('demo bundle', () => {
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

    // Visit each view. A regression that activates RestDataSource under
    // demo mode will fire `/api/scan`, `/api/nodes`, etc. on view init.
    await page.goto('./files');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('nav-graph').click();
    await page.waitForLoadState('networkidle');

    expect(
      apiCalls,
      `Demo bundle fetched live-mode endpoints — DataSource leaked into demo:\n${apiCalls.join('\n')}`,
    ).toEqual([]);
  });

  test('renders the two views without errors', async ({ page }) => {
    await page.goto('./');
    await page.waitForLoadState('networkidle');

    await page.goto('./files');
    await expect(page).toHaveURL(/\/files/);

    await page.getByTestId('nav-graph').click();
    await expect(page).toHaveURL(/\/map/);
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
