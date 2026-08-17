import { expect, test, type Page } from '@playwright/test';
import { seedProjectStorage } from '../_storage.js';

/**
 * Files-rail rows stay PAINTED across sorting and scrolling.
 *
 * Born as a guard for a real-user report (sorting the rail made rows
 * "disappear"): a row `animate.leave` slide whose `forwards` fill ended
 * at `opacity: 0` got stranded on a trackBy-reused `<tr>` mid-animation
 * and pinned a live row invisible. That fix removed every row animation,
 * so the original failure mode is gone (see the standing prohibition in
 * `ui/src/app/views/files-view/files-view.css`, above `.files__row`).
 *
 * The suite is kept, and re-aimed, because the virtualised table has a
 * NEW way to blank rows: the scroller keeps its `first` index across a
 * row-set shrink and resizes its spacer a macrotask late, so a collapse
 * or a sort while scrolled down can render an empty slice for a frame.
 * The audit below is agnostic to which of the two causes is at play: it
 * reads COMPUTED opacity / visibility / display, so anything that blanks
 * a row surfaces here regardless of class bookkeeping or scroll state.
 */

test.use({ contextOptions: { reducedMotion: 'reduce' } });

async function gotoFiles(page: Page): Promise<void> {
  // Stamp the storage version FIRST: an unversioned seed reads as
  // pre-namespace leftovers and the UI's gate wipes it at boot.
  await seedProjectStorage(page);
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

/** Settle after a re-render. Rows carry no animation any more, so this only
 *  has to cover the virtual scroller recomputing its window. */
const SETTLE_MS = 150;

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

  test('rows stay painted while the virtual window slides', async ({ page }) => {
    // The failure mode virtualisation introduces: the scroller keeps a stale
    // `first` index across a row-set change and can render an empty slice.
    // Expand, travel to the bottom and back, and audit at each stop.
    await gotoFiles(page);
    await page.getByTestId('files-expand-all').click();
    await page.waitForTimeout(SETTLE_MS);

    const scroller = page.getByTestId('files-scroller');
    for (const position of ['bottom', 'middle', 'top'] as const) {
      await scroller.evaluate((el, where) => {
        el.scrollTop = where === 'bottom' ? el.scrollHeight
          : where === 'middle' ? Math.round(el.scrollHeight / 2)
            : 0;
      }, position);
      await page.waitForTimeout(SETTLE_MS);
      const audit = await auditRows(page);
      expect(audit.total, `${position}: rows present`).toBeGreaterThan(0);
      expect(audit.invisible, `${position}: no invisible rows`).toBe(0);
    }

    // And after collapsing from the far end, the shape most likely to leave
    // the scroller pointing past the end of a shrunken listing.
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.getByTestId('files-collapse-all').click();
    await page.waitForTimeout(SETTLE_MS);
    const afterCollapse = await auditRows(page);
    expect(afterCollapse.total, 'after collapse: rows present').toBeGreaterThan(0);
    expect(afterCollapse.invisible, 'after collapse: no invisible rows').toBe(0);
  });
});
