/**
 * Live-BFF ignore flow (the files-rail Ignore button end to end).
 *
 * Exercises the real BFF + UI + disk artifacts together, over the three
 * sacrificial `notes/*.md` fixture files (owned by this spec, see
 * `fixture.ts`):
 *
 *   1. Confirmed ignore: the row's ban glyph opens the confirmation
 *      dialog (root-anchored pattern rendered verbatim), Ignore appends
 *      the pattern to the project-root `.skillmapignore`, the route's
 *      watcher restart re-scan drops the node, and the rail row
 *      disappears without a reload.
 *   2. Don't-ask-again: the checkbox persists `ui.confirmIgnore: false`
 *      into `.skill-map/settings.local.json`.
 *   3. Suppressed ignore: the next click writes directly, no dialog.
 *
 * The inspector-header affordance and the error / demo paths stay
 * covered by the unit suites (`project-ignore.spec.ts`,
 * `ignore-confirm-dialog.spec.ts`, `files-view.interactions.spec.ts`,
 * `inspector-view.spec.ts`); this spec owns the disk + watcher circle
 * no unit test can reach.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from './_fixtures.js';

const SCRATCH = 'notes/scratch.md';
const TODO = 'notes/todo.md';
const DRAFT = 'notes/draft.md';

/** Rail refreshes ride the watcher-restart re-scan; give it slack. */
const RESCAN_TIMEOUT = 15_000;

function fixtureCwd(): string {
  const cwd = process.env['LIVE_BFF_FIXTURE_CWD'];
  if (!cwd) throw new Error('LIVE_BFF_FIXTURE_CWD is not set (globalSetup did not run).');
  return cwd;
}

test.describe('live-BFF ignore flow', () => {
  test('confirmed, remembered, then suppressed ignores land on disk and clear the rail', async ({
    page,
    liveBffUrl,
  }) => {
    // Seed the rail OPEN (same recipe as the bump spec: the workspace
    // opens map-first by default).
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('sm.workspace.rail-collapsed', '0');
      } catch {
        /* localStorage unavailable before first paint; ignore. */
      }
    });
    await page.goto(liveBffUrl);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('shell')).toBeVisible();

    // Folders render collapsed; expand the tree so the notes rows mount.
    await page.getByTestId('files-expand-all').click();
    await expect(page.getByTestId(`files-leaf-${SCRATCH}`)).toBeVisible();

    // 1. Confirmed ignore. The ban glyph is hover-revealed (opacity),
    //    which Playwright can click regardless; hover first anyway so
    //    the interaction mirrors a real user.
    await page.getByTestId(`files-leaf-${SCRATCH}`).hover();
    await page.getByTestId(`files-ignore-leaf-${SCRATCH}`).click();

    // Assert on the dialog CONTENT, not the `p-dialog` host tag: with
    // `appendTo="body"` the host stays in place (empty, hidden) while
    // the open dialog portals its content to `document.body`.
    const dialogBody = page.getByTestId('ignore-confirm-body');
    await expect(dialogBody).toBeVisible();
    await expect(page.getByTestId('ignore-confirm-pattern')).toHaveText(`/${SCRATCH}`);
    await page.getByTestId('ignore-confirm-accept').click();

    await expect(page.getByTestId(`files-leaf-${SCRATCH}`)).toBeHidden({
      timeout: RESCAN_TIMEOUT,
    });
    expect(readFileSync(join(fixtureCwd(), '.skillmapignore'), 'utf8')).toContain(`/${SCRATCH}`);

    // 2. Don't-ask-again on the second file.
    await page.getByTestId(`files-leaf-${TODO}`).hover();
    await page.getByTestId(`files-ignore-leaf-${TODO}`).click();
    await expect(dialogBody).toBeVisible();
    await page.getByTestId('ignore-confirm-always-row').click();
    await page.getByTestId('ignore-confirm-accept').click();

    await expect(page.getByTestId(`files-leaf-${TODO}`)).toBeHidden({ timeout: RESCAN_TIMEOUT });
    await expect
      .poll(
        () =>
          JSON.parse(
            readFileSync(join(fixtureCwd(), '.skill-map', 'settings.local.json'), 'utf8'),
          ).ui?.confirmIgnore,
        { timeout: 5_000 },
      )
      .toBe(false);

    // 3. Suppressed: the third click writes directly, no dialog. The
    //    row vanishing IS the proof of the dialog-less write (a parked
    //    dialog would block the append and the row would survive); the
    //    content-count check is the belt on top.
    await page.getByTestId(`files-leaf-${DRAFT}`).hover();
    await page.getByTestId(`files-ignore-leaf-${DRAFT}`).click();
    await expect(page.getByTestId(`files-leaf-${DRAFT}`)).toBeHidden({ timeout: RESCAN_TIMEOUT });
    await expect(dialogBody).toHaveCount(0);
    const ignoreFile = readFileSync(join(fixtureCwd(), '.skillmapignore'), 'utf8');
    expect(ignoreFile).toContain(`/${DRAFT}`);
    // All three appends accumulated (replace-list PATCH folded, none dropped).
    expect(ignoreFile).toContain(`/${SCRATCH}`);
    expect(ignoreFile).toContain(`/${TODO}`);
  });
});
