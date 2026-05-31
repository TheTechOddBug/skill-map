---
"@skill-map/cli": patch
---

The UI WebSocket client no longer raises a stream error when it gives up reconnecting after the dev server stops. It now exposes a `connectionState` signal instead: a new `<sm-connection-banner>` shows a non-fatal "connection lost" notice with a Reconnect button, the data stream stays alive, and the collection re-seeds via `/api/scan` once the socket re-opens. This stops a routine `sm serve` shutdown from surfacing in Sentry as an uncaught error.

## User-facing

When the dev server stops, the UI now shows a "connection lost" banner with a Reconnect button instead of failing silently, and it refreshes automatically once the connection is back.
