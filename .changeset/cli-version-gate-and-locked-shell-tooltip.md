---
'@skill-map/spec': patch
'@skill-map/cli': patch
---

The browser-storage reset gate now keys on the serving CLI version: `sm serve` (and the demo bundle) stamps a second `skill-map-version` meta, documented in the CLI contract's serve row, and upgrades wipe only what a crossed layout-break threshold declares, so a normal release keeps saved state. The locked Shell capture option is no longer natively disabled: it renders muted, refuses the click, and its tooltip explains where to enable it.

## User-facing

**The greyed-out Shell option now explains itself.** Hover it to see how to enable it (Settings > Project > Capture level). And upgrading the CLI no longer resets your saved layout and recordings unless the release actually changed how they are stored.
