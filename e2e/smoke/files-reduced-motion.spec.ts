import { expect, test, type Page } from '@playwright/test';

/**
 * Files-rail sorting under `prefers-reduced-motion: reduce`.
 *
 * Default-CI browser guard for a real-user report: sorting the files
 * rail made rows "disappear". Root cause was a row `animate.leave`
 * slide whose `forwards` fill ended at `opacity: 0`; a re-render that
 * re-used a leaving `<tr>` mid-animation stranded the class and pinned
 * a live row invisible. The faithful reproduction needs live activity
 * churn (see `e2e/live-bff/specs/activity-sort.spec.ts`); this static
 * smoke complements it with cheap default-CI coverage that plain sort
 * reordering never blanks a row, including under reduced motion.
 *
 * The fix removed `animate.leave` from the rows entirely and kept only
 * an enter slide gated behind `@media (prefers-reduced-motion:
 * no-preference)`. This suite audits PAINTED visibility (computed
 * opacity / visibility / display), so a re-introduced hiding animation
 * surfaces here regardless of class bookkeeping.
 */

test.use({ contextOptions: { reducedMotion: 'reduce' } });

async function gotoFiles(page: Page): Promise<void> {
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
}

/** Count rows present in the DOM vs rows painted invisible. */
async function auditRows(page: Page): Promise<{ total: number; invisible: number }> {
  return page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        'tr[data-testid^="files-leaf-"], tr[data-testid^="files-folder-"]',
      ),
    );
    let invisible = 0;
    for (const row of rows) {
      const style = getComputedStyle(row);
      if (Number(style.opacity) === 0 || style.visibility === 'hidden' || style.display === 'none') {
        invisible++;
      }
    }
    return { total: rows.length, invisible };
  });
}

/** Give any enter/leave teardown time to settle (fallback = duration + 50ms). */
const SETTLE_MS = 600;

test.describe('files rail sorting under reduced motion', () => {
  test('rows stay painted across activity -> tokens -> toggle -> tree', async ({ page }) => {
    await gotoFiles(page);

    const boot = await auditRows(page);
    expect(boot.total, 'boot: rows present').toBeGreaterThan(0);
    expect(boot.invisible, 'boot: no invisible rows').toBe(0);

    const steps: Array<{ step: string; testid: string }> = [
      { step: 'activity', testid: 'files-col-activity' },
      { step: 'tokens', testid: 'files-col-tokens' },
      { step: 'tokens-asc', testid: 'files-col-tokens' },
      { step: 'tree', testid: 'files-col-tree' },
    ];

    for (const { step, testid } of steps) {
      await page.getByTestId(testid).click();
      await page.waitForTimeout(SETTLE_MS);
      const audit = await auditRows(page);
      expect(audit.total, `${step}: rows present`).toBeGreaterThan(0);
      expect(audit.invisible, `${step}: no invisible rows`).toBe(0);
    }
  });
});
