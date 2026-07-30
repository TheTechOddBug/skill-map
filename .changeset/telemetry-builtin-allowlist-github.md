---
'@skill-map/cli': patch
---

The telemetry allow-list was missing `github`, a built-in that ships with the CLI, so its extension ids collapsed to `external_plugin` and its usage was misreported as third-party. Two guard tests now pin both directions: no id may be in the list unless the CLI actually ships it (the direction that would leak), and every shipped built-in must be in it (the direction that only costs signal).
