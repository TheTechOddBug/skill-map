import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for specs that assert against the files rail.
 *
 * The rail's table is VIRTUALISED: only the rows inside the render window
 * plus a buffer exist in the DOM. Every `tr[data-testid^="files-"]` query is
 * therefore a query about the window, not about the listing.
 *
 * The demo dataset is small enough that the whole corpus fits one viewport,
 * which is why the existing DOM-order assertions (sort monotonicity, "this
 * nested row is visible") are still total. That is an assumption, not a
 * guarantee, and it stops holding silently the day the fixture grows, so
 * `expectSingleViewport` pins it: the assertion that depends on it fails
 * here, naming its own cause, instead of degrading into "the window happens
 * to be sorted".
 */

/**
 * Assert the rail is not scrollable, i.e. every row is rendered and DOM-order
 * assertions cover the whole listing.
 */
export async function expectSingleViewport(page: Page): Promise<void> {
  const fits = await page
    .getByTestId('files-scroller')
    .evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
  expect(
    fits,
    'files rail must fit in one viewport for whole-listing assertions to hold; '
      + 'the corpus grew past the render window, so scope the assertion or scroll explicitly',
  ).toBe(true);
}
