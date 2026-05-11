---
"@skill-map/cli": patch
---

`update available` banner now fires on the first invocation after a fresh install or a `npm i -g` upgrade. Previously the banner required two runs to surface: the first run loaded the empty / not-yet-populated cache row, skipped the banner, fetched the latest from npm, and persisted the cache; only the second run actually printed the message. Operators who installed and ran `sm` once a day effectively never saw the notification because the cache freshness window (24h) and the run cadence collided.

**Root cause** — `runWithAdapter` in `src/cli/util/update-check-banner.ts` decided whether to print the banner BEFORE the registry fetch, using only the cached `latestVersion`. A null / equal-to-current cache short-circuited the banner block; the fresh `latest` value the fetch returned was persisted but never consulted by the current run.

**Fix** — after a successful fetch, re-evaluate `isOutdated(VERSION, latest)` and emit the banner in the SAME run when the cache-side branch did not already fire and the 24h cooldown (`shownAt`) is clear. The persisted `shownAt` is updated accordingly so the 24h banner cadence still holds across subsequent runs. A guard (`didShowThisRun`) prevents double emission when both branches happen to point at the same outdated version.

## User-facing

Update-available banner now appears on the very first `sm` run after installing or upgrading the CLI, instead of waiting until the second run. Once-per-day cadence after that is unchanged.
