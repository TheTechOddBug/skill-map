---
"@skill-map/cli": patch
---

"Capture conversations" can no longer be turned on while the real-time hook is not installed, in both Quick Start and Settings. Without the hook no activity event ever reaches skill-map, so the toggle looked available and achieved nothing. Enabling is gated (disabling always works, and an unknown hook state fails open), the row explains what is missing, and the Quick Start indicator stops reporting a hookless capture as ready.

## User-facing

The "Capture conversations" switch now stays locked, and tells you why, until the real-time hook is installed.
