---
"@skill-map/cli": patch
---

Fix a project with `ui.liveUpdates` persisted OFF still flash-opening the live channel at startup. The preference load and the cold-start probes were two separate app-initializers, so the first `/ws` subscriber was constructed before the awaited preference GET resolved and the socket opened on the ON default, which the late OFF never closed. Both steps are now folded into one awaited initializer (`settleLivePrefsThenColdStart`) that settles the preference before the loader is built.

## User-facing

**Live Updates now stays off when you turn it off.** A project with Live Updates disabled no longer auto-refreshes the map on file saves; it updates on your next manual scan, matching the toggle.
