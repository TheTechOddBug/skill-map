---
"@skill-map/cli": patch
---

Part 8 (`cli`) of the bundled `sm-tutorial` skill now self-seeds its own copy of the Part 0 demo fixture (`preflight: seed`, new `prologue-built` snapshot) instead of assuming it is still on disk. Before, running the campaign after the prologue deleted that fixture, yet Part 8 stayed in the menu and ran against the wrong project. Now it rebuilds the fixture on entry (resetting the portfolio if present) and, like the campaign parts, is always shown.

## User-facing

The built-in tutorial's CLI deep-dive now rebuilds its own demo fixture when you enter it, so it works correctly even after you have run the project campaign, and it always appears in the menu instead of staying hidden until the prologue is done.
