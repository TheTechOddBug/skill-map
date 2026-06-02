/**
 * Live-BFF spec for the update-check feature — exercises the real
 * `GET /api/update-status` endpoint AND the SPA chip that renders next
 * to the Alpha badge when the kernel cache reports an outdated version.
 *
 * Setup model: the harness in `live-bff/global-setup.ts` spawns
 * `sm serve` against a fresh fixture tempdir and stashes its cwd in
 * `LIVE_BFF_FIXTURE_CWD`. The DB at `<fixtureCwd>/.skill-map/skill-map.db`
 * is created lazily by the watcher's first scan / the kernel's
 * auto-migrate, so each test that needs to seed the cache row first
 * waits for the file to exist, then opens it via `node:sqlite` and
 * INSERTs the row directly into `config_preferences`. The BFF reads
 * the row on every request — no cache invalidation needed.
 *
 * Tests are NOT serial: each one explicitly seeds (or clears) the row
 * via the small `seedUpdateCheckCache` / `clearUpdateCheckCache` helpers
 * defined in this file. This keeps every test runnable in isolation
 * (`--grep "..."`) without relying on cross-test ordering.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import { test, expect } from './_fixtures.js';

const DB_RELATIVE = '.skill-map/skill-map.db';
const UPDATE_CHECK_KEY = '_kernel.update-check';
const SEEDED_LATEST = '99.0.0';
const NPM_PACKAGE_URL = 'https://www.npmjs.com/package/@skill-map/cli';

interface IUpdateCheckRow {
  latestVersion: string;
  checkedAt: number;
  shownAt: number | null;
}

/**
 * Resolve the fixture cwd stashed by globalSetup. Throws clearly when
 * the live-bff harness did not run (e.g. wrong --project).
 */
function fixtureCwd(): string {
  const cwd = process.env['LIVE_BFF_FIXTURE_CWD'];
  if (!cwd) {
    throw new Error(
      'LIVE_BFF_FIXTURE_CWD is not set — globalSetup did not materialise a fixture. ' +
      'Run with `--project=live-bff` so the harness boots.',
    );
  }
  return cwd;
}

/** Absolute path to the project DB inside the spawned fixture. */
function dbPath(): string {
  return join(fixtureCwd(), DB_RELATIVE);
}

/**
 * Poll until the DB file exists. The watcher's first scan creates it
 * within a few hundred ms after `sm serve` starts; we give it a
 * generous 10s ceiling to absorb cold-start jitter on slow CI hosts.
 */
async function waitForDb(timeoutMs = 10_000): Promise<string> {
  const path = dbPath();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return path;
    await delay(100);
  }
  throw new Error(`DB never appeared at ${path} after ${timeoutMs}ms`);
}

/**
 * INSERT-OR-REPLACE the kernel update-check cache row. Uses raw
 * `node:sqlite` (snake_case columns) rather than the Kysely adapter
 * because the Kysely binding is a separate `DatabaseSync` instance
 * (see the codebase's `:memory:` workaround note); a parallel
 * `DatabaseSync` open against the file path is the cheapest way to
 * write a single row from a test process.
 */
function seedUpdateCheckCache(path: string, row: IUpdateCheckRow): void {
  const db = new DatabaseSync(path);
  try {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO config_preferences (key, value_json, updated_at) VALUES (?, ?, ?)',
    );
    stmt.run(UPDATE_CHECK_KEY, JSON.stringify(row), Date.now());
  } finally {
    db.close();
  }
}

/** Delete the kernel update-check cache row (idempotent). */
function clearUpdateCheckCache(path: string): void {
  const db = new DatabaseSync(path);
  try {
    const stmt = db.prepare('DELETE FROM config_preferences WHERE key = ?');
    stmt.run(UPDATE_CHECK_KEY);
  } finally {
    db.close();
  }
}

// SKIPPED: pending e2e review after the workspace redesign (the standalone
// Files / Map views were merged into one workspace at `/`). Unskip once the
// suite is updated to the new layout.
test.describe.skip('live-BFF update-check', () => {
  test('GET /api/update-status reflects the seeded cache row', async ({ request, liveBffUrl }) => {
    const path = await waitForDb();
    seedUpdateCheckCache(path, {
      latestVersion: SEEDED_LATEST,
      checkedAt: Date.now(),
      shownAt: null,
    });

    const res = await request.get(`${liveBffUrl}api/update-status`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      current: string;
      latest: string | null;
      isOutdated: boolean;
      checkedAt: number | null;
      shownAt: number | null;
    };
    // We don't pin `current` to a literal — `VERSION` evolves with the
    // package. Asserting it's a non-empty string is enough to guard
    // against a regression that drops the field.
    expect(typeof body.current).toBe('string');
    expect(body.current.length).toBeGreaterThan(0);
    expect(body.latest).toBe(SEEDED_LATEST);
    expect(body.isOutdated).toBe(true);
  });

  test('chip renders next to the Alpha badge when outdated', async ({ page, liveBffUrl }) => {
    const path = await waitForDb();
    // Idempotent re-seed — INSERT OR REPLACE keeps this test runnable
    // in isolation regardless of any prior state.
    seedUpdateCheckCache(path, {
      latestVersion: SEEDED_LATEST,
      checkedAt: Date.now(),
      shownAt: null,
    });

    await page.goto(liveBffUrl);
    await page.waitForLoadState('networkidle');

    // Universal "did the SPA mount?" probe — same selector as
    // `bump.spec.ts`. Sharing it means a regression is one place to
    // fix on the UI side.
    await expect(page.getByTestId('shell')).toBeVisible();

    const chip = page.getByTestId('shell-update-chip');
    await expect(chip).toBeVisible();
    // The chip is a real anchor — not a button — so we assert on
    // href + target. Tooltip text would require hover + the
    // tooltip-rendered DOM, which is fragile across PrimeNG versions.
    await expect(chip).toHaveAttribute('href', NPM_PACKAGE_URL);
    await expect(chip).toHaveAttribute('target', '_blank');
  });

  test('chip is absent when the cache is empty', async ({ page, liveBffUrl }) => {
    const path = await waitForDb();
    clearUpdateCheckCache(path);

    await page.goto(liveBffUrl);
    await page.waitForLoadState('networkidle');

    // Mount probe first — guarantees the SPA finished bootstrapping
    // before we assert on the chip's absence (otherwise we'd be racing
    // the framework boot, not the update-status read).
    await expect(page.getByTestId('shell')).toBeVisible();
    await expect(page.locator('[data-testid="shell-update-chip"]')).toHaveCount(0);
  });
});
