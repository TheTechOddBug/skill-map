---
"@skill-map/cli": minor
---

Stop the reconnect re-seed storm when the server flaps. The SPA re-seeds (`GET /api/scan` plus the cascading node / issue fetches) only after the WebSocket RE-STABILISES, not on every raw `open`. A flapping connection (a `--watch` BFF restarting, a rolling deploy) opens then drops within the stability window, so re-seeding on each open hammered the read endpoints with `ECONNREFUSED`; gating on a new `stableConnected` signal fires at most one re-seed per recovered connection.

## User-facing

**No more request storm when the dev server restarts.** The UI waits for the connection to stabilise before re-fetching, instead of hammering the API every time a restarting server flaps the socket.
