import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Files view column-sorting smoke tests (demo-mode harness).
 *
 * The static demo bundle at `/demo/` ships a fixed dataset, so the
 * sort order is deterministic and assertable. The pure sort engine
 * (comparators, `nextSort`, storage) is unit-tested in
 * `ui/src/app/views/files-view/__tests__/files-view.{rows,sort}.spec.ts`;
 * this suite covers the end-to-end wiring the unit tests can't reach:
 *
 *   - clicking a data-column header flattens the tree into a sorted
 *     listing (folder rows gone, leaves ordered by the column),
 *   - the active header reflects direction via `aria-sort`,
 *   - re-clicking toggles direction, the tree header restores the tree,
 *   - the choice survives a reload (localStorage),
 *   - a file row shows its full path in a SINGLE-LINE tooltip.
 */

async function gotoFiles(page: Page): Promise<void> {
  await page.goto('./');
  await page.waitForLoadState('networkidle');
  await page.goto('./files');
  await expect(page).toHaveURL(/\/files/);
  await expect(page.getByTestId('files-table')).toBeVisible();
}

const leafRows = (page: Page): Locator => page.locator('tr[data-testid^="files-leaf-"]');
const folderRows = (page: Page): Locator => page.locator('tr[data-testid^="files-folder-"]');

/** Token value per leaf row in DOM order; non-numeric (`·`) cells are
 *  dropped so the monotonicity check ignores missing-value rows (which
 *  always sink to the bottom). */
async function tokenSequence(page: Page): Promise<number[]> {
  const rows = leafRows(page);
  const count = await rows.count();
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const text = (await rows.nth(i).locator('.files__cell-num').last().innerText()).trim();
    const value = text.endsWith('k')
      ? Number(text.slice(0, -1)) * 1000
      : Number(text);
    if (!Number.isNaN(value)) values.push(value);
  }
  return values;
}

const isNonIncreasing = (a: number[]): boolean => a.every((v, i) => i === 0 || a[i - 1] >= v);
const isNonDecreasing = (a: number[]): boolean => a.every((v, i) => i === 0 || a[i - 1] <= v);

test.describe('files view column sorting (smoke)', () => {
  test('boots into the folder tree with no active column sort', async ({ page }) => {
    await gotoFiles(page);
    expect(await folderRows(page).count()).toBeGreaterThan(0);
    await expect(page.getByTestId('files-col-tokens')).toHaveAttribute('aria-sort', 'none');
  });

  test('sorting by Tokens flattens the tree into a descending listing', async ({ page }) => {
    await gotoFiles(page);
    await page.getByTestId('files-col-tokens').click();

    await expect(page.getByTestId('files-col-tokens')).toHaveAttribute('aria-sort', 'descending');
    // Flat mode: folder rows are gone, leaves remain.
    expect(await folderRows(page).count()).toBe(0);
    expect(await leafRows(page).count()).toBeGreaterThan(0);

    const tokens = await tokenSequence(page);
    expect(tokens.length).toBeGreaterThan(1);
    expect(isNonIncreasing(tokens)).toBe(true);
  });

  test('re-clicking the column toggles to ascending', async ({ page }) => {
    await gotoFiles(page);
    const header = page.getByTestId('files-col-tokens');
    await header.click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await header.click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');

    const tokens = await tokenSequence(page);
    expect(tokens.length).toBeGreaterThan(1);
    expect(isNonDecreasing(tokens)).toBe(true);
  });

  test('the Folder / Node header restores the tree', async ({ page }) => {
    await gotoFiles(page);
    await page.getByTestId('files-col-tokens').click();
    expect(await folderRows(page).count()).toBe(0);

    await page.getByTestId('files-col-tree').click();
    expect(await folderRows(page).count()).toBeGreaterThan(0);
    await expect(page.getByTestId('files-col-tokens')).toHaveAttribute('aria-sort', 'none');
  });

  test('the sort choice persists across a reload', async ({ page }) => {
    await gotoFiles(page);
    await page.getByTestId('files-col-tokens').click();
    await expect(page.getByTestId('files-col-tokens')).toHaveAttribute('aria-sort', 'descending');

    await page.reload();
    await expect(page.getByTestId('files-table')).toBeVisible();
    await expect(page.getByTestId('files-col-tokens')).toHaveAttribute('aria-sort', 'descending');
    expect(await folderRows(page).count()).toBe(0);
  });

  test('a file row shows its full path in a single-line tooltip', async ({ page }) => {
    await gotoFiles(page);
    // Flat mode renders the name + dimmed path + path tooltip.
    await page.getByTestId('files-col-tokens').click();

    // Pick a nested file so the tooltip carries a real directory path.
    const testids = await leafRows(page).evaluateAll((rows) =>
      rows.map((r) => r.getAttribute('data-testid') ?? ''),
    );
    const nested = testids
      .map((id) => id.replace(/^files-leaf-/, ''))
      .find((path) => path.includes('/'));
    expect(nested, 'demo bundle should have at least one nested file').toBeTruthy();

    await page.getByTestId(`files-leaf-${nested}`).locator('.files__name-wrap').hover();

    const tooltipText = page.locator('.files__path-tooltip .p-tooltip-text');
    await expect(tooltipText).toBeVisible();
    await expect(tooltipText).toHaveText(nested!);
    const whiteSpace = await tooltipText.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(whiteSpace).toBe('nowrap');
  });
});
