---
"@skill-map/cli": patch
---

The graph map's camera behaviour changes on two interactions. Clicking a tag chip on a card now curates the map in place without panning or zooming, so the operator stays on the card they clicked. The explicit re-arrange and fit-to-screen buttons now glide the camera to the new framing instead of snapping, matching the automatic auto-fit that already animated on scan add / remove. Which nodes get framed is unchanged.

## User-facing

Clicking a tag on a card now filters the map without jumping the view around, it stays where you are. And the Re-arrange and Fit buttons glide the map into place instead of snapping, so it is easier to follow where things moved.
