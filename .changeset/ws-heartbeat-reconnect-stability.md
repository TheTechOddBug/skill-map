---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The `/ws` server now pings every client every 30s so idle connections survive intermediary proxies and half-open peers get terminated, and the SPA's WebSocket client resets its reconnect backoff only after a connection stays open long enough to be stable. Together these stop a flapping connection from looping at 1s and re-seeding `GET /api/scan` in a tight poll storm; an unrecoverable drop now escalates to the non-fatal 'connection lost' state.

## User-facing

**The live view stops hammering the server on a dropped connection.** Idle tabs stay connected instead of silently dropping, and a connection that cannot recover now shows a clear 'connection lost' notice instead of retrying scans forever in the background.
