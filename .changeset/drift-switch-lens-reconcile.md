---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Switching the active-provider lens from the marker-drift notice now dismisses it. `PATCH /api/active-provider` refreshes the `activeProviderMarkers` snapshot to the detected set as part of the switch (mirroring the CLI's `sm config set activeProvider`), so the drift banner clears on a lens change instead of lingering. Previously only the explicit Dismiss (`POST /api/active-provider/accept-markers`) reconciled the snapshot, so switching lens left the notice up.

## User-facing

The "new provider markers detected" banner now goes away after you switch lens from it, not only when you press its dismiss button.
