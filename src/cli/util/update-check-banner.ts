/**
 * `maybeRunUpdateCheck` — glue between the kernel update-check helpers
 * and the CLI surface. Designed to run AFTER `cli.run()` so the
 * verb's own output is already on the wire; the banner emits to
 * stderr, never blocks stdout, and never affects a verb's exit code.
 *
 * Bail conditions (in order — short-circuits skip BOTH the banner and
 * the registry probe):
 *   1. `process.env.SM_NO_UPDATE_CHECK === '1'` — operator opt-out.
 *   2. `process.env.CI` truthy                 — never noisy in CI.
 *   3. `stderr.isTTY !== true`                  — pipes / redirects.
 *   4. project DB missing                       — no scope to read from.
 *   5. `updateCheck.enabled === false` in effective config.
 *
 * On a clean run:
 *   - load the cache row from `config_preferences`,
 *   - if outdated AND (`!shownAt` OR `now - shownAt > 24h`):
 *       print the banner + persist `shownAt = now`,
 *   - if cache stale (`now - checkedAt > 24h`) OR cache null:
 *       fetch the latest version with a 1500ms timeout
 *       and persist the new cache,
 *   - silently swallow every error — the banner must never crash
 *     a verb's exit path.
 *
 * Lives under `cli/util/` because every env / settings read happens
 * here (kernel boundary lint forbids those reads from `core/` and
 * `kernel/`).
 */

import { existsSync } from 'node:fs';

import { tx } from '../../kernel/util/tx.js';
import { withSqlite } from '../../core/sqlite/with-sqlite.js';
import { readConfigValue } from '../../core/config/helper.js';
import { fetchLatestVersion, isOutdated } from '../../core/update-check/index.js';
import { UPDATE_CHECK_TEXTS } from '../i18n/update-check.texts.js';
import { VERSION } from '../version.js';
import { ansiFor } from './ansi.js';
import type { StoragePort } from '../../kernel/ports/storage.js';

const PACKAGE_NAME = '@skill-map/cli';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

export interface IMaybeRunUpdateCheckOptions {
  /** Absolute path to the project DB. May not exist on disk. */
  dbPath: string;
  /** Process cwd, threaded through to `loadConfig`. */
  cwd: string;
  /** User home directory, threaded through to `loadConfig`. */
  homedir: string;
  /** Stderr stream; banner emits here. */
  stderr: NodeJS.WriteStream;
  /** Forwarded to `ansiFor`. Post-run, no parsed flags are reachable. */
  noColorFlag: boolean;
}

/**
 * Run the once-per-day update probe + banner. Silent on every failure
 * mode. Never throws.
 */
export async function maybeRunUpdateCheck(
  opts: IMaybeRunUpdateCheckOptions,
): Promise<void> {
  try {
    if (shouldBailFromEnv(opts.stderr)) return;
    if (!existsSync(opts.dbPath)) return;
    if (!isUpdateCheckEnabled(opts)) return;

    await withSqlite(
      { databasePath: opts.dbPath, autoBackup: false },
      async (adapter) => {
        await runWithAdapter(adapter, opts);
      },
    );
  } catch {
    // Silent — the banner is non-essential and must never crash exit.
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function shouldBailFromEnv(stderr: NodeJS.WriteStream): boolean {
  if (process.env['SM_NO_UPDATE_CHECK'] === '1') return true;
  if (isTruthy(process.env['CI'])) return true;
  if (stderr.isTTY !== true) return true;
  return false;
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined || value === '') return false;
  // GitHub / many CI providers set `CI=true`; treat anything non-empty
  // and not literal `0` / `false` as truthy. Matches the spirit of
  // `npm-config-style` boolean parsing.
  const lower = value.toLowerCase();
  if (lower === '0' || lower === 'false' || lower === 'no') return false;
  return true;
}

function isUpdateCheckEnabled(opts: IMaybeRunUpdateCheckOptions): boolean {
  // `updateCheck.enabled` is a USER-only key (`core/config/helper`
  // pins it via `USER_ONLY_KEYS`), so the read is always against the
  // global / user layer regardless of the `scope` we pass — a stray
  // project-layer entry from an older install is intentionally
  // ignored. Default to enabled when the key is absent (matches the
  // pre-helper behavior + the `project-config.schema.json` default).
  try {
    const enabled = readConfigValue<boolean>('updateCheck.enabled', {
      scope: 'global',
      cwd: opts.cwd,
      homedir: opts.homedir,
      default: true,
    });
    return enabled !== false;
  } catch {
    // A malformed settings.json should never silence the banner
    // permanently, but it should also not crash the boot hook.
    // Default to enabled and let the next normal verb surface the
    // config warning.
    return true;
  }
}

// The banner-vs-refresh decision tree intentionally lives in one
// function so the read / decide / write happens against a single
// adapter handle. Splitting into "decide" + "act" helpers would
// require duplicating the cache-shape branches on each side.
// eslint-disable-next-line complexity
async function runWithAdapter(
  adapter: StoragePort,
  opts: IMaybeRunUpdateCheckOptions,
): Promise<void> {
  const cache = await adapter.preferences.loadUpdateCheckCache();
  const now = Date.now();

  // Banner: print iff we have a cache, it points at a newer version,
  // and we haven't shown it in the last 24h. The freshness check
  // uses `checkedAt` ONLY for the refresh decision — `shownAt`
  // governs the banner cadence.
  if (cache && isOutdated(VERSION, cache.latestVersion)) {
    const dueToShow = cache.shownAt === null || now - cache.shownAt > ONE_DAY_MS;
    if (dueToShow) {
      writeBanner(opts, cache.latestVersion);
      try {
        await adapter.preferences.saveUpdateCheckCache({
          latestVersion: cache.latestVersion,
          checkedAt: cache.checkedAt,
          shownAt: now,
        });
      } catch {
        // ignore — banner already printed, persistence is best-effort.
      }
    }
  }

  // Refresh: fetch when cache is missing or stale (>24h since last
  // probe). The fetch happens AFTER the banner read so a network
  // delay doesn't slow down the user-visible output.
  const cacheStale = !cache || now - cache.checkedAt > ONE_DAY_MS;
  if (!cacheStale) return;
  let latest: string;
  try {
    latest = await fetchLatestVersion(PACKAGE_NAME, { timeoutMs: FETCH_TIMEOUT_MS });
  } catch {
    // Network down / registry unreachable / timeout. Leave cache
    // as-is so the next run retries.
    return;
  }
  try {
    await adapter.preferences.saveUpdateCheckCache({
      latestVersion: latest,
      checkedAt: now,
      shownAt: cache?.shownAt ?? null,
    });
  } catch {
    // ignore — failed write means the next run probes again.
  }
}

function writeBanner(opts: IMaybeRunUpdateCheckOptions, latestVersion: string): void {
  const ansi = ansiFor({
    isTTY: opts.stderr.isTTY === true,
    noColorFlag: opts.noColorFlag,
  });
  const block = tx(UPDATE_CHECK_TEXTS.available, {
    glyph: ansi.cyan('ℹ'),
    current: VERSION,
    latest: latestVersion,
    hint: ansi.dim(UPDATE_CHECK_TEXTS.availableHint),
  });
  opts.stderr.write(block);
}
