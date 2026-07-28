---
'@skill-map/cli': patch
---

Selecting a node no longer makes the whole graph lurch left and glide back while the inspector opens. The a11y focus move onto the opening panel scrolled the overflow-hidden canvas wrap to reveal the still-sliding-in panel; the focus now passes `preventScroll` so the camera stays put.

## User-facing

Fixed a visual glitch where opening the inspector made the whole map shift left and slide back in under a second.
